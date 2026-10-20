import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { pool } from "../db";
import { HttpError, readJson } from "../errors";
import { optionalBoolean, requireEnum, requireTime } from "../validate";

export const notificationsRouter = new Hono<AppEnv>();

// POST /notifications/tokens { token: "ExponentPushToken[...]", platform?: "ios" | "android" | "web" }
// Call after the app gets permission (expo-notifications getExpoPushTokenAsync). Re-registering
// the same token is fine; a token that moved to another account is reassigned.
notificationsRouter.post("/tokens", async (c) => {
  const body = await readJson(c);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!/^(Exponent|Expo)PushToken\[.+\]$/.test(token) || token.length > 255) {
    throw new HttpError(400, "token must be an Expo push token like ExponentPushToken[xxxx]");
  }
  const platform = body?.platform === undefined ? null : requireEnum(body.platform, "platform", ["ios", "android", "web"] as const);
  const { rows } = await pool.query(
    `INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform
     RETURNING id, token, platform, created_at`,
    [c.get("user").id, token, platform],
  );
  return c.json(rows[0], 201);
});

// DELETE /notifications/tokens/:token — call on logout so this phone stops getting reminders.
notificationsRouter.delete("/tokens/:token", async (c) => {
  await pool.query("DELETE FROM push_tokens WHERE token = $1 AND user_id = $2", [c.req.param("token"), c.get("user").id]);
  return c.body(null, 204);
});

notificationsRouter.get("/settings", async (c) => {
  const { rows } = await pool.query("SELECT reminder_enabled, reminder_time, timezone FROM users WHERE id = $1", [
    c.get("user").id,
  ]);
  return c.json(rows[0]);
});

// PUT /notifications/settings { reminder_enabled, reminder_time: "20:00" } — in the user's timezone.
notificationsRouter.put("/settings", async (c) => {
  const body = await readJson(c);
  const userId = c.get("user").id;
  const current = (await pool.query("SELECT reminder_enabled, reminder_time FROM users WHERE id = $1", [userId])).rows[0];
  const enabled = optionalBoolean(body?.reminder_enabled, "reminder_enabled", current.reminder_enabled);
  const time = body?.reminder_time === undefined ? current.reminder_time : requireTime(body.reminder_time, "reminder_time");
  const { rows } = await pool.query(
    "UPDATE users SET reminder_enabled = $1, reminder_time = $2 WHERE id = $3 RETURNING reminder_enabled, reminder_time, timezone",
    [enabled, time, userId],
  );
  return c.json(rows[0]);
});
