import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// Starts the local PaddleOCR service (backend/ocr-service) together with the API, so receipt scans
// use PaddleOCR instead of quietly falling back to the much weaker Tesseract. It only starts it when
// it has been set up (`bun run ocr setup`, or one `bun run ocr`) and isn't already running.
// Set OCR_AUTOSTART=off to manage it yourself.

const dir = resolve(import.meta.dir, "..", "ocr-service");
const python = process.platform === "win32" ? join(dir, ".venv", "Scripts", "python.exe") : join(dir, ".venv", "bin", "python");

export async function startOcrService(): Promise<void> {
  const url = process.env.OCR_SERVICE_URL ?? "http://127.0.0.1:8866";
  if (process.env.OCR_AUTOSTART === "off" || url === "off" || !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return;
  if (!existsSync(python)) {
    console.log("Receipt OCR: PaddleOCR isn't set up, using Tesseract. Run `bun run ocr setup` once for much better scans.");
    return;
  }
  const running = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
  if (running) return; // already up (started by hand, or by a previous run of `bun --watch`)

  const port = new URL(url).port || "8866";
  const child = Bun.spawn([python, "server.py"], {
    cwd: dir,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, PYTHONIOENCODING: "utf-8", OCR_SERVICE_PORT: port },
  });
  console.log("Receipt OCR: starting PaddleOCR…");
  // It stops with the API (Ctrl+C). If one is still running when the API starts again, it is reused.
  const stop = () => child.kill();
  process.once("SIGINT", () => { stop(); process.exit(0); });
  process.once("SIGTERM", () => { stop(); process.exit(0); });
  process.once("exit", stop);
}
