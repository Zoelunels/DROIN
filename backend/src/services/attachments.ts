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

export function storedPath(storedName: string): string {
  return join(UPLOAD_DIR, storedName);
}

// Saves an uploaded file under a random name (never the user's file name, so no path tricks).
export async function saveUpload(file: File): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const storedName = `${crypto.randomUUID()}.${ALLOWED_MIME_TYPES[file.type]}`;
  await Bun.write(storedPath(storedName), file);
  return storedName;
}

// Best effort: a file that is already gone is not an error.
export async function removeStoredFiles(storedNames: string[]): Promise<void> {
  for (const name of storedNames) {
    await unlink(storedPath(name)).catch(() => {});
  }
}
