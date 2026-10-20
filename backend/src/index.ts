import { app } from "./app";
import { startScheduler } from "./scheduler";

const port = Number(process.env.PORT ?? 3000);

console.log(`DROIN API running at http://localhost:${port}`);
startScheduler();

// Bun automatically serves the default export if it has a `fetch` (Bun.serve).
export default {
  port,
  fetch: app.fetch,
};
