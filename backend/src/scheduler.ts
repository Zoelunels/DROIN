import { pool } from "./db";
import { sendDailyReminders } from "./services/push";
import { processDueRules } from "./services/recurring";

// Background jobs, run inside the API process (good enough for a single server).
//   every minute      daily reminders (each user at their own reminder_time)
//   every 10 minutes  recurring rules due today
//   every hour        forget idempotency keys older than 24 hours
// Each job is skipped while its previous run is still going.

function every(ms: number, name: string, job: () => Promise<unknown>, runNow = false): Timer {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await job();
    } catch (err) {
      console.error(`Job "${name}" failed:`, err);
    } finally {
      running = false;
    }
  };
  if (runNow) void run();
  return setInterval(run, ms);
}

export function startScheduler(): () => void {
  const timers = [
    every(60_000, "reminders", sendDailyReminders),
    every(10 * 60_000, "recurring", async () => {
      const created = await processDueRules();
      if (created > 0) console.log(`Recurring: created ${created} transaction(s)`);
    }, true),
    every(60 * 60_000, "idempotency cleanup", () =>
      pool.query("DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'"), true),
  ];
  return () => timers.forEach(clearInterval);
}
