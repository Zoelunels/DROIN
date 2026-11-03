// Runs the local PaddleOCR service (backend/ocr-service), setting it up the first time.
//   bun run ocr          set up if needed, then start it on http://127.0.0.1:8866
//   bun run ocr setup    only set up (create ocr-service/.venv and install requirements.txt)
// Needs Python 3.10+ on PATH (or set PYTHON=path/to/python). Everything stays inside ocr-service/.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve(import.meta.dir, "..", "ocr-service");
const venv = join(dir, ".venv");
const python = process.platform === "win32" ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python");

async function run(cmd: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(cmd, { cwd: dir, stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, PYTHONIOENCODING: "utf-8", ...env } });
  const code = await proc.exited;
  if (code !== 0) process.exit(code);
}

if (!existsSync(python)) {
  const system = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  console.log(`Setting up the OCR service with ${system} (one time, ~300 MB)…`);
  await run([system, "-m", "venv", venv]);
  // Keep pip's download cache out of the way (no-cache): the models already ship inside rapidocr.
  await run([python, "-m", "pip", "install", "--no-cache-dir", "-q", "-r", "requirements.txt"]);
  console.log("OCR service installed.");
}

if (process.argv[2] !== "setup") await run([python, "server.py"]);
