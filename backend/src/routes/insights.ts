import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { HttpError, readJson } from "../errors";
import { buildInsights } from "../services/insights";
import { pool } from "../db";
import { parseQuickInput, splitItems } from "../services/quickInput";
import { transcribe } from "../services/speech";
import { monthIn } from "../time";
import { requireMonth } from "../validate";

export const insightsRouter = new Hono<AppEnv>();

// GET /insights?month=YYYY-MM (default: this month in the user's timezone)
insightsRouter.get("/", async (c) => {
  const user = c.get("user");
  const monthQuery = c.req.query("month");
  const month = monthQuery === undefined ? monthIn(user.timezone) : requireMonth(monthQuery, "month");
  return c.json({ month, insights: await buildInsights(user.id, user.timezone, month) });
});

export const quickInputRouter = new Hono<AppEnv>();

// POST /quick-input/parse { text: "lunch 25k gopay" } → a transaction draft (nothing is saved).
// The app pre-fills its form with it; the user then saves through POST /transactions.
quickInputRouter.post("/parse", async (c) => {
  const body = await readJson(c);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (text === "") throw new HttpError(400, "text is required");
  if (text.length > 200) throw new HttpError(400, "text must be at most 200 characters");
  const user = c.get("user");
  return c.json(await parseQuickInput(user.id, user.timezone, text));
});

const MAX_AUDIO_BYTES = 3 * 1024 * 1024; // ~3 minutes of AAC; the app stops recording at 30 s

// POST /quick-input/voice  multipart/form-data, field "audio" (m4a/aac/mp3/wav/webm/ogg)
// → { transcript, drafts: [draft, …] }. Nothing is saved, same as /parse. "kopi 25 ribu, parkir
// goceng" gives two drafts.
quickInputRouter.post("/voice", async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new HttpError(400, "Send the recording as multipart/form-data in a field named \"audio\"");
  }
  const audio = form.get("audio");
  if (!(audio instanceof File)) throw new HttpError(400, "Send the recording in a field named \"audio\"");
  // Bun derives the type from the file name; some phones send a generic type or no extension.
  const isAudio =
    /^(audio\/|video\/(mp4|3gpp|webm)$)/.test(audio.type) ||
    (/^(application\/octet-stream)?$/.test(audio.type) && /\.(m4a|mp4|aac|caf|mp3|wav|webm|ogg|3gp)$/i.test(audio.name));
  if (!isAudio) {
    throw new HttpError(415, "Unsupported recording type. Send audio (m4a, aac, mp3, wav, webm or ogg)");
  }
  if (audio.size === 0) throw new HttpError(422, "That recording is empty. Hold the mic a bit longer");
  if (audio.size > MAX_AUDIO_BYTES) throw new HttpError(413, "Recording is too long (max 3 MB)");

  const user = c.get("user");
  const wallets = await pool.query(
    "SELECT name FROM wallets WHERE user_id = $1 AND archived_at IS NULL ORDER BY id",
    [user.id],
  );
  const transcript = await transcribe(audio, wallets.rows.map((w) => w.name));
  if (transcript === "") throw new HttpError(422, "Didn't catch that. Try again, a little closer to the mic");

  const items = splitItems(transcript.slice(0, 500));
  const drafts = [];
  for (const item of items) drafts.push(await parseQuickInput(user.id, user.timezone, item));
  // "kopi 25rb, parkir 5rb kemarin": a date said once applies to every item that has none.
  const spokenDate = drafts.find((d) => d.matched.date === "text")?.transaction_date;
  if (spokenDate) {
    for (const d of drafts) if (d.matched.date === "default") d.transaction_date = spokenDate;
  }
  return c.json({ transcript, drafts });
});
