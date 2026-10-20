import { Hono } from "hono";
import { bearerToken, createSession, hashPassword, requireAuth, sha256, verifyPassword, type AppEnv } from "../auth";
import { pool, withTransaction } from "../db";
import { HttpError, readJson } from "../errors";
import { seedDefaultCategories } from "../services/categories";
import { requireEmail, requirePassword, requireString, requireTimezone } from "../validate";

export const authRouter = new Hono<AppEnv>();

const PUBLIC_USER_COLUMNS = "id, email, name, timezone, reminder_enabled, reminder_time, created_at";

// POST /auth/register → creates the account with default categories and logs in.
authRouter.post("/register", async (c) => {
  const body = await readJson(c);
  const email = requireEmail(body?.email);
  const password = requirePassword(body?.password);
  const name = requireString(body?.name, "name");
  const timezone = body?.timezone === undefined ? "Asia/Jakarta" : requireTimezone(body.timezone);
  const passwordHash = await hashPassword(password);

  const user = await withTransaction(async (client) => {
    const existing = await client.query("SELECT 1 FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) throw new HttpError(409, "This email is already registered");
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, name, timezone) VALUES ($1, $2, $3, $4) RETURNING ${PUBLIC_USER_COLUMNS}`,
      [email, passwordHash, name, timezone],
    );
    await seedDefaultCategories(client, rows[0].id);
    return rows[0];
  });

  return c.json({ user, token: await createSession(user.id) }, 201);
});

authRouter.post("/login", async (c) => {
  const body = await readJson(c);
  const email = requireEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";

  const { rows } = await pool.query(`SELECT ${PUBLIC_USER_COLUMNS}, password_hash FROM users WHERE email = $1`, [email]);
  const row = rows[0];
  // Same message for "no such email" and "wrong password", so the API does not reveal which emails exist.
  if (!row?.password_hash || !(await verifyPassword(password, row.password_hash))) {
    throw new HttpError(401, "Email or password is incorrect");
  }
  const { password_hash, ...user } = row;
  return c.json({ user, token: await createSession(user.id) });
});

// Everything below needs a logged-in user.
authRouter.use("/logout", requireAuth);
authRouter.use("/me", requireAuth);
authRouter.use("/password", requireAuth);

authRouter.post("/logout", async (c) => {
  const token = bearerToken(c.req.header("Authorization"));
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token ?? "")]);
  return c.body(null, 204);
});

authRouter.get("/me", async (c) => {
  const { rows } = await pool.query(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = $1`, [c.get("user").id]);
  return c.json(rows[0]);
});

// PUT /auth/me — name, email and timezone. Fields that are left out stay unchanged.
authRouter.put("/me", async (c) => {
  const body = await readJson(c);
  const current = c.get("user");
  const name = body?.name === undefined ? current.name : requireString(body.name, "name");
  const email = body?.email === undefined ? current.email : requireEmail(body.email);
  const timezone = body?.timezone === undefined ? current.timezone : requireTimezone(body.timezone);

  if (email !== current.email) {
    const taken = await pool.query("SELECT 1 FROM users WHERE email = $1 AND id <> $2", [email, current.id]);
    if (taken.rows.length > 0) throw new HttpError(409, "This email is already registered");
  }
  const { rows } = await pool.query(
    `UPDATE users SET name = $1, email = $2, timezone = $3 WHERE id = $4 RETURNING ${PUBLIC_USER_COLUMNS}`,
    [name, email, timezone, current.id],
  );
  return c.json(rows[0]);
});

// PUT /auth/password — changing the password logs out every other device.
authRouter.put("/password", async (c) => {
  const body = await readJson(c);
  const userId = c.get("user").id;
  const newPassword = requirePassword(body?.new_password, "new_password");

  const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
  const hash = rows[0]?.password_hash;
  if (hash && !(await verifyPassword(String(body?.current_password ?? ""), hash))) {
    throw new HttpError(400, "current_password is incorrect");
  }

  const currentToken = bearerToken(c.req.header("Authorization")) ?? "";
  await withTransaction(async (client) => {
    await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [await hashPassword(newPassword), userId]);
    await client.query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [userId, sha256(currentToken)]);
  });
  return c.body(null, 204);
});
