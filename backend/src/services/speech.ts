import { HttpError } from "../errors";

// Speech-to-text for voice quick input. The phone records a short clip (Expo Go has no on-device
// speech recognition), the API sends it to an OpenAI-compatible /audio/transcriptions endpoint —
// Groq (whisper-large-v3-turbo) and OpenAI (gpt-4o-mini-transcribe, whisper-1) both speak it —
// and the text then goes through the same parser as typed quick input.
//
// Configured in .env: STT_API_KEY (required), STT_API_URL, STT_MODEL, STT_LANGUAGE.
// The key stays on the server; the app never sees it.

export type Transcriber = (audio: File, options: { language: string; prompt: string }) => Promise<string>;

const DEFAULT_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "whisper-large-v3-turbo";

const openAiCompatible: Transcriber = async (audio, { language, prompt }) => {
  const key = process.env.STT_API_KEY;
  if (!key) throw new HttpError(503, "Voice input is not set up on the server (STT_API_KEY is missing)");
  const form = new FormData();
  form.append("file", audio, audio.name || "voice.m4a");
  form.append("model", process.env.STT_MODEL || DEFAULT_MODEL);
  form.append("language", language);
  form.append("prompt", prompt);
  form.append("response_format", "json");
  form.append("temperature", "0");

  let res: Response;
  try {
    res = await fetch(`${(process.env.STT_API_URL || DEFAULT_URL).replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    console.error("Speech-to-text request failed:", err);
    throw new HttpError(502, "The speech service is unreachable. Try again, or type it instead");
  }
  if (!res.ok) {
    console.error(`Speech-to-text returned ${res.status}:`, (await res.text().catch(() => "")).slice(0, 500));
    throw new HttpError(502, "The speech service could not transcribe that. Try again, or type it instead");
  }
  const data = (await res.json().catch(() => ({}))) as { text?: unknown };
  return typeof data.text === "string" ? data.text : "";
};

let transcriber: Transcriber = openAiCompatible;

// Tests swap in a fake so they never call the real API. Pass nothing to restore it.
export function setTranscriber(fake?: Transcriber) {
  transcriber = fake ?? openAiCompatible;
}

// Whisper "hears" these in silence or noise. Treated as nothing said.
const HALLUCINATIONS =
  /^(terima kasih( sudah menonton| telah menonton)?|thank you( for watching)?|thanks for watching|sampai jumpa|subscribe|ok(e|ay)?|hmm+|uh+|eh+|\.+)$/i;

export async function transcribe(audio: File, walletNames: string[]): Promise<string> {
  // A hint in the same style as the expected speech helps with numbers, slang and wallet names.
  const prompt = [
    "Catatan keuangan, campur bahasa Indonesia dan Inggris.",
    "Contoh: makan 25 ribu pakai GoPay kemarin. Kopi 18rb, parkir 5 ribu. Gaji 8 juta BCA.",
    walletNames.length > 0 ? `Dompet: ${walletNames.slice(0, 20).join(", ")}.` : "",
  ].join(" ").trim();
  const text = (await transcriber(audio, { language: process.env.STT_LANGUAGE || "id", prompt }))
    .replace(/\s+/g, " ")
    .trim();
  const bare = text.replace(/[.!?,]+$/g, "").trim();
  return HALLUCINATIONS.test(bare) || bare === "" ? "" : text;
}
