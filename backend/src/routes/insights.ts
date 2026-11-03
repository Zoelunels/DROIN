import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { HttpError, readJson } from "../errors";
import { buildInsights } from "../services/insights";
import { pool } from "../db";
import { parseQuickInput, splitItems } from "../services/quickInput";
import { detectFileType } from "../services/attachments";
import { readPdfText, readReceipt } from "../services/ocr";
import { parseReceipt } from "../services/receipt";
import { transcribe } from "../services/speech";
import { monthIn, todayIn } from "../time";
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

const RECEIPT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

// POST /quick-input/receipt  multipart/form-data, field "image" (a photo of a receipt / struk or an
// invoice, or an invoice PDF) → { kind, text, merchant, total, date, payment, draft }. Nothing is saved:
// the app shows the draft, then saves it with POST /transactions and attaches the file with
// POST /transactions/:id/attachments.
quickInputRouter.post("/receipt", async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new HttpError(400, "Send the photo as multipart/form-data in a field named \"image\"");
  }
  const image = form.get("image");
  if (!(image instanceof File)) throw new HttpError(400, "Send the photo in a field named \"image\"");
  if (image.size === 0) throw new HttpError(422, "That file is empty");
  if (image.size > MAX_RECEIPT_BYTES) throw new HttpError(413, "File is too large (max 5 MB)");
  // The bytes decide what the file is: phones don't always send the right type with an upload.
  const type = await detectFileType(image);
  if (!type || !RECEIPT_TYPES.has(type)) throw new HttpError(415, "Send a JPEG, PNG or WebP photo, or a PDF invoice");

  const user = c.get("user");
  const bytes = new Uint8Array(await image.arrayBuffer());
  const isPdf = type === "application/pdf";
  const { text, engine } = isPdf ? { text: await readPdfText(bytes), engine: "pdf-text" as const } : await readReceipt(bytes);
  // Fewer than a handful of letters and digits: a blurry photo, a scanned PDF, or not a receipt at all.
  if ((text.match(/[\p{L}\p{N}]/gu) ?? []).length < 8) {
    throw new HttpError(
      422,
      isPdf
        ? "That PDF has no text in it (it's a scan). Take a photo or screenshot of it instead"
        : "Couldn't read that receipt. Try a sharper, flatter photo with good light",
    );
  }
  const info = parseReceipt(text, todayIn(user.timezone));

  // Category and wallet guesses come from the same rules as typed input, using the shop name
  // ("Indomaret" → Groceries, "Kopi Senja" → Food & Drinks). Amount, date and note come from the receipt.
  const draft = await parseQuickInput(user.id, user.timezone, info.merchant ?? "struk");
  draft.amount = info.total;
  draft.matched.amount = info.total !== null;
  draft.note = info.merchant;
  if (info.date) {
    draft.transaction_date = info.date;
    draft.matched.date = "text";
  }
  if (info.payment) {
    // "QRIS"/"Debit" don't name a wallet; a wallet called GoPay/BCA/… or a cash wallet does.
    const { rows: wallets } = await pool.query(
      "SELECT id, name, wallet_type FROM wallets WHERE user_id = $1 AND archived_at IS NULL ORDER BY id",
      [user.id],
    );
    const payment = info.payment.toLowerCase();
    const wallet =
      wallets.find((w) => w.name.toLowerCase() === payment) ??
      wallets.find((w) => w.name.toLowerCase().includes(payment)) ??
      (payment === "cash" ? wallets.find((w) => w.wallet_type === "cash") : undefined);
    if (wallet) {
      draft.wallet_id = wallet.id;
      draft.wallet_name = wallet.name;
      draft.matched.wallet = "name";
    }
  }

  // engine: "paddleocr", "tesseract" (the weak fallback: double-check the amount) or "pdf-text".
  return c.json({ text: text.slice(0, 3000), engine, ...info, draft });
});
