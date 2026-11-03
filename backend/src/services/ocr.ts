import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { getDocumentProxy } from "unpdf";
import { HttpError } from "../errors";

// Reads text from receipt photos. Both readers are free and private: nothing leaves this machine.
//
// 1. PaddleOCR (preferred): PaddleOCR's PP-OCR models in a small local Python service
//    (backend/ocr-service, run on ONNX Runtime by RapidOCR). Far better than Tesseract on real photos:
//    faded thermal print, tilted or curled paper, shadows. It returns text boxes with their positions,
//    which are put back together into printed rows here (rowsFromBoxes).
// 2. Tesseract (fallback, used whenever the service isn't running or fails): runs inside this server.
//    Indonesian + English language data (~15 MB) is downloaded from the jsDelivr CDN on the first scan
//    and cached in TESSDATA_DIR (default backend/.tessdata), so later scans work offline. One worker
//    is reused for every request; Tesseract queues jobs, so scans run one after another.

export type ReceiptReader = (image: Uint8Array) => Promise<string>;

// Set OCR_SERVICE_URL to "off" to always use Tesseract.
const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL ?? "http://127.0.0.1:8866";
const SERVICE_TIMEOUT_MS = 30_000;

const TESSDATA_DIR = resolve(import.meta.dir, "..", "..", process.env.TESSDATA_DIR ?? ".tessdata");
const READ_TIMEOUT_MS = 45_000; // the first scan also downloads the language data

let worker: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  worker ??= (async () => {
    // Tesseract only caches the language files if the folder already exists.
    await mkdir(TESSDATA_DIR, { recursive: true });
    const w = await createWorker(["ind", "eng"], 1, { cachePath: TESSDATA_DIR });
    // A receipt is two columns with a wide gap (name … price). Tesseract's automatic layout splits
    // them into separate blocks and drops the right one, losing the prices and the amounts after
    // TOTAL / TUNAI / KEMBALI. Reading the photo as one uniform block keeps every row together, and
    // keeping the spaces keeps "AQUA 600ML   2   4.000   8.000" readable as columns.
    await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" });
    return w;
  })().catch((err) => {
    worker = null; // e.g. offline on the very first scan: try again next time
    throw err;
  });
  return worker;
}

const OCR_WIDTH = 1800; // px: thermal print is small; this size gives Tesseract ~30 px tall digits

/**
 * Cleans a receipt photo up for OCR: upright (phone EXIF rotation), grey, enlarged, contrast stretched
 * (faded thermal print becomes dark on light) and sharpened. On a faded test receipt this took
 * Tesseract from 5 to 12 of 12 amounts and labels read correctly. Not black-and-white: a hard
 * threshold wipes out faded print entirely. If the image can't be processed, the original is used.
 */
export async function prepareForOcr(image: Uint8Array): Promise<Buffer> {
  try {
    return await sharp(image).rotate().grayscale().resize({ width: OCR_WIDTH }).normalise().sharpen({ sigma: 1 }).toColourspace("b-w").png().toBuffer();
  } catch {
    return Buffer.from(image);
  }
}

const tesseract: ReceiptReader = async (image) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const w = await getWorker();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), READ_TIMEOUT_MS);
    });
    const { data } = await Promise.race([w.recognize(await prepareForOcr(image)), timeout]);
    return data.text;
  } catch (err) {
    console.error("Receipt OCR failed:", err);
    throw new HttpError(502, "Couldn't read receipts right now. Try again, or type it in");
  } finally {
    clearTimeout(timer);
  }
};

/** One text box from the OCR service: its text and its four corners (clockwise from top-left). */
export interface OcrBox {
  text: string;
  box: [number, number][];
  score?: number;
}

// px: keeps the upload to the service small. Smaller photos are sent as they are: the detector scales
// them itself, and enlarging a blurry photo first made it find no text at all.
const PADDLE_MAX_WIDTH = 2000;

const paddle = async (image: Uint8Array): Promise<string> => {
  // Upright (phone EXIF rotation) and not huge. No other clean-up: the PP-OCR models were trained on
  // ordinary photos and read colour/grey images better than Tesseract-style black-on-white.
  let body: Uint8Array = image;
  try {
    body = await sharp(image).rotate().resize({ width: PADDLE_MAX_WIDTH, withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  } catch {
    // not something sharp can read: let the service try the original
  }
  const res = await fetch(`${OCR_SERVICE_URL}/ocr`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body,
    signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OCR service answered ${res.status}`);
  const { lines } = (await res.json()) as { lines: OcrBox[] };
  return rowsFromBoxes(lines);
};

let serviceDownLogged = false;

export type OcrEngine = "paddleocr" | "tesseract" | "pdf-text" | "test";

/** PaddleOCR when its service is running, otherwise Tesseract. Scanning never depends on the service. */
async function bestRead(image: Uint8Array): Promise<{ text: string; engine: OcrEngine }> {
  if (OCR_SERVICE_URL !== "off") {
    try {
      const text = await paddle(image);
      serviceDownLogged = false;
      // Nothing found at all (a very small or very blurry photo): Tesseract gets a second look.
      if (text.trim()) return { text, engine: "paddleocr" };
    } catch (err) {
      // Not running is normal (it's optional), so say it once, not on every scan.
      if (!serviceDownLogged) {
        console.warn(`PaddleOCR service unavailable (${(err as Error).message}); using Tesseract, which misreads faded receipts. Start it with \`bun run ocr\`.`);
      }
      serviceDownLogged = true;
    }
  }
  return { text: await tesseract(image), engine: "tesseract" };
}
const bestReader: ReceiptReader = async (image) => (await bestRead(image)).text;

/**
 * Puts the service's text boxes back into printed rows, top to bottom, left to right. A receipt row
 * like "TOTAL ........ 80.100" comes back as two boxes far apart; they belong together when their
 * middles are at the same height. Photos are rarely straight, so the page's tilt (the median slope of
 * the boxes' top edges) is taken out first; otherwise on a tilted receipt the right-hand amount drifts
 * into the row above or below its label. A wide gap inside a row is kept as several spaces, like the
 * column gaps the parser already knows from Tesseract.
 */
export function rowsFromBoxes(boxes: OcrBox[]): string {
  const items = boxes
    .filter((b) => b.text.trim() && b.box.length >= 4)
    .map((b) => {
      const [tl, tr, br, bl] = b.box as [[number, number], [number, number], [number, number], [number, number]];
      return {
        text: b.text.trim(),
        left: Math.min(tl[0], bl[0]),
        right: Math.max(tr[0], br[0]),
        cx: (tl[0] + tr[0] + br[0] + bl[0]) / 4,
        cy: (tl[1] + tr[1] + br[1] + bl[1]) / 4,
        height: Math.max(1, (bl[1] - tl[1] + (br[1] - tr[1])) / 2),
        slope: tr[0] - tl[0] > 0 ? (tr[1] - tl[1]) / (tr[0] - tl[0]) : 0,
      };
    });
  if (items.length === 0) return "";

  // Long boxes give the most reliable slope; ignore single characters.
  const slopes = items.filter((i) => i.right - i.left > i.height * 2).map((i) => i.slope).sort((a, b) => a - b);
  const tilt = slopes.length ? slopes[Math.floor(slopes.length / 2)]! : 0;
  const level = items.map((i) => ({ ...i, y: i.cy - tilt * i.cx })).sort((a, b) => a.y - b.y);

  const rows: { y: number; height: number; parts: typeof level }[] = [];
  for (const item of level) {
    const row = rows.find((r) => Math.abs(r.y - item.y) < Math.min(r.height, item.height) * 0.6);
    if (row) {
      row.parts.push(item);
      row.y = row.parts.reduce((sum, p) => sum + p.y, 0) / row.parts.length;
      row.height = Math.max(row.height, item.height);
    } else {
      rows.push({ y: item.y, height: item.height, parts: [item] });
    }
  }

  return rows
    .sort((a, b) => a.y - b.y)
    .map((row) => {
      const parts = row.parts.sort((a, b) => a.left - b.left);
      return parts.map((p, i) => (i === 0 ? "" : p.left - parts[i - 1]!.right > row.height * 1.5 ? "   " : " ") + p.text).join("");
    })
    .join("\n");
}

let reader: ReceiptReader = bestReader;

// Tests swap in a fake so they don't need an OCR engine or the network. Pass nothing to restore it.
export function setReceiptReader(fake?: ReceiptReader) {
  reader = fake ?? bestReader;
}

/** The text of a receipt photo, and which engine read it (so a weak Tesseract read can be spotted). */
export async function readReceipt(image: Uint8Array): Promise<{ text: string; engine: OcrEngine }> {
  if (reader !== bestReader) return { text: (await reader(image)).trim(), engine: "test" };
  const { text, engine } = await bestRead(image);
  return { text: text.trim(), engine };
}

// Invoices often come as PDFs (e-invoices, PLN/Telkom bills, marketplace invoices). Those carry their
// text inside, so it is read directly: no OCR, exact numbers. Only the first pages matter for a total.
const MAX_PDF_PAGES = 3;

interface PdfTextItem {
  str: string;
  transform: number[]; // [a, b, c, d, x, y]
}

export async function readPdfText(pdf: Uint8Array): Promise<string> {
  let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    doc = await getDocumentProxy(pdf);
  } catch {
    throw new HttpError(422, "That PDF can't be opened. Is it damaged or password protected?");
  }
  try {
    const texts: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      texts.push(linesOf(content.items as PdfTextItem[]));
    }
    return texts.join("\n").trim();
  } finally {
    await doc.loadingTask.destroy();
  }
}

// PDF text comes in loose pieces. Pieces at the same height are one printed line ("Total Tagihan" …
// "Rp90.000" far to the right), which is how the receipt parser expects to see them.
function linesOf(items: PdfTextItem[]): string {
  const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    let row = rows.find((r) => Math.abs(r.y - y) < 3);
    if (!row) rows.push((row = { y, parts: [] }));
    row.parts.push({ x, s: item.str.trim() });
  }
  return rows
    .sort((a, b) => b.y - a.y) // PDF y grows upwards
    .map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" "))
    .join("\n");
}
