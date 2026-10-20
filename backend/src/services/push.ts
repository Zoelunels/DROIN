import { pool } from "../db";

// Sends push notifications through Expo's push service (works for Expo Go and EAS builds).
// Set PUSH_NOTIFICATIONS=off to only log them (e.g. while developing).
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export async function sendPush(messages: PushMessage[]): Promise<void> {
  if (messages.length === 0) return;
  if (process.env.PUSH_NOTIFICATIONS === "off") {
    for (const m of messages) console.log(`[push skipped] ${m.to}: ${m.title} — ${m.body}`);
    return;
  }

  // Expo accepts up to 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(batch.map((m) => ({ ...m, sound: "default" }))),
    });
    if (!res.ok) {
      console.error(`Expo push failed: ${res.status} ${await res.text()}`);
      continue;
    }
    // Tokens of uninstalled apps come back as DeviceNotRegistered: forget them.
    const { data } = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
    const dead = batch.filter((_, idx) => data?.[idx]?.details?.error === "DeviceNotRegistered").map((m) => m.to);
    if (dead.length > 0) await pool.query("DELETE FROM push_tokens WHERE token = ANY($1)", [dead]);
  }
}

// Daily "did you log anything?" reminder. Runs every minute from the scheduler and sends at most
// one reminder per user per day, at or after their reminder_time (in their own timezone), and
// only if they have not added anything that day.
export async function sendDailyReminders(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT u.id, (now() AT TIME ZONE u.timezone)::date AS local_today
     FROM users u
     WHERE u.reminder_enabled
       AND (now() AT TIME ZONE u.timezone)::time >= u.reminder_time
       AND u.last_reminded_on IS DISTINCT FROM (now() AT TIME ZONE u.timezone)::date
       AND EXISTS (SELECT 1 FROM push_tokens p WHERE p.user_id = u.id)`,
  );
  let sent = 0;
  for (const user of rows) {
    // Claim today's reminder first, so a slow send can never trigger a second one.
    const claimed = await pool.query(
      "UPDATE users SET last_reminded_on = $2 WHERE id = $1 AND last_reminded_on IS DISTINCT FROM $2",
      [user.id, user.local_today],
    );
    if (claimed.rowCount === 0) continue;

    const logged = await pool.query(
      "SELECT 1 FROM transactions WHERE user_id = $1 AND transaction_date = $2 AND origin = 'manual' LIMIT 1",
      [user.id, user.local_today],
    );
    if (logged.rows.length > 0) continue;

    const tokens = await pool.query("SELECT token FROM push_tokens WHERE user_id = $1", [user.id]);
    await sendPush(
      tokens.rows.map((t) => ({
        to: t.token,
        title: "Anything go in today?",
        body: "Nothing happened here today. Suspicious. Tap to put something in.",
        data: { screen: "add-transaction" },
      })),
    );
    sent++;
  }
  return sent;
}
