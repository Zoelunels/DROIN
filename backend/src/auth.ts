import type { MiddlewareHandler } from "hono";
import { pool } from "./db";
import { HttpError } from "./errors";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  timezone: string;
}

// Typed context for every protected router: c.get("user") is always set after requireAuth.
export type AppEnv = { Variables: { user: AuthUser } };

const SESSION_DAYS = 90;

export function sha256(data: string | ArrayBuffer | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

// Argon2id via Bun's built-in hasher.
export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

// Creates a login session and returns the raw token. The client sends it back as
// `Authorization: Bearer <token>`; the DB only keeps its hash.
export async function createSession(userId: number): Promise<string> {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [userId, sha256(token), SESSION_DAYS],
  );
  return token;
}

export function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearerToken(c.req.header("Authorization"));
  if (!token) throw new HttpError(401, "Login required");

  const { rows } = await pool.query(
    `SELECT s.id AS session_id, s.last_used_at, u.id, u.email, u.name, u.timezone
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  const row = rows[0];
  if (!row) throw new HttpError(401, "Session expired or invalid, please log in again");

  // Sliding expiry, but write at most once an hour instead of on every request.
  if (Date.now() - new Date(row.last_used_at).getTime() > 3_600_000) {
    await pool.query(
      `UPDATE sessions SET last_used_at = now(), expires_at = now() + make_interval(days => $2) WHERE id = $1`,
      [row.session_id, SESSION_DAYS],
    );
  }

  c.set("user", { id: row.id, email: row.email, name: row.name, timezone: row.timezone });
  await next();
};
