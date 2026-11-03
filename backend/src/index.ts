import { app } from "./app";
import { startOcrService } from "./ocrService";
import { startScheduler } from "./scheduler";

const port = Number(process.env.PORT ?? 3000);

console.log(`DROIN API running at http://localhost:${port}`);
startScheduler();
void startOcrService();

// Bun automatically serves the default export if it has a `fetch` (Bun.serve).
export default {
  port,
  fetch: app.fetch,
  // Bun closes a connection that sends nothing for 10 s by default, and the app then shows "can't
  // reach the drawer". Reading a receipt can take longer (the very first scan also downloads the
  // OCR language data), so give requests up to 2 minutes.
  idleTimeout: 120,
};
