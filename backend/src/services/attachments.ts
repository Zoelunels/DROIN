import { mkdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

// Receipts are stored on local disk. UPLOAD_DIR is relative to the backend folder by default.
export const UPLOAD_DIR = resolve(import.meta.dir, "..", "..", process.env.UPLOAD_DIR ?? "uploads");
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

// The type a file really is, from its first bytes. Phones don't always label uploads (an empty or
// generic type, or a guess from the file name), so the bytes decide, and the label is the fallback.
export async function detectFileType(file: File): Promise<string | null> {
  const b = new Uint8Array(await file.arrayBuffer()).subarray(0, 12);
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "%PDF") return "application/pdf";
  if (ascii(4, 8) === "ftyp" && /^(heic|heix|mif1|msf1)$/.test(ascii(8, 12))) return "image/heic";
  return ALLOWED_MIME_TYPES[file.type] ? file.type : null;
}

export function storedPath(storedName: string): string {
  return join(UPLOAD_DIR, storedName);
}

// Saves an uploaded file under a random name (never the user's file name, so no path tricks).
export async function saveUpload(file: File, type: string): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const storedName = `${crypto.randomUUID()}.${ALLOWED_MIME_TYPES[type]}`;
  await Bun.write(storedPath(storedName), file);
  return storedName;
}

// Best effort: a file that is already gone is not an error.
export async function removeStoredFiles(storedNames: string[]): Promise<void> {
  for (const name of storedNames) {
    await unlink(storedPath(name)).catch(() => {});
  }
}
