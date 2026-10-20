import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./auth";
import { pool } from "./db";
import { HttpError } from "./errors";

// Makes POST requests safe to retry. Phones lose signal: if "save transaction" times out
// and the app retries, without this the transaction (and its balance change) happens twice.
//
// The client sends a unique `Idempotency-Key` header per action (e.g. a UUID made when the
// user taps Save) and reuses it for every retry of that action:
//   - first time        → the request runs and its response is stored
//   - same key + body   → the stored response is returned (header Idempotency-Replayed: true)
//   - same key, new body → 422, the key was meant for a different request
//   - first still running → 409, try again shortly
// Keys are kept for 24 hours (cleaned up by the scheduler). Requests without the header run normally.
export const idempotency: MiddlewareHandler<AppEnv> = async (c, next) => {
  const key = c.req.header("Idempotency-Key");
  if (c.req.method !== "POST" || !key) return next();
  if (key.length > 255) throw new HttpError(400, "Idempotency-Key is too long (max 255)");

  const userId = c.get("user").id;
  const body = await c.req.arrayBuffer(); // Hono caches it, so the handler can still read it
  const requestHash = new Bun.CryptoHasher("sha256").update(`${c.req.method} ${c.req.path}\n`).update(body).digest("hex");

  const claimed = await pool.query(
    `INSERT INTO idempotency_keys (user_id, key, method, path, request_hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, key) DO NOTHING`,
    [userId, key, c.req.method, c.req.path, requestHash],
  );

  if (claimed.rowCount === 0) {
    const { rows } = await pool.query("SELECT * FROM idempotency_keys WHERE user_id = $1 AND key = $2", [userId, key]);
    const saved = rows[0];
    if (!saved || saved.request_hash !== requestHash) {
      throw new HttpError(422, "This Idempotency-Key was already used for a different request");
    }
    if (saved.status_code === null) {
      throw new HttpError(409, "A request with this Idempotency-Key is still being processed");
    }
    return new Response(saved.response_body, {
      status: saved.status_code,
      headers: { "Content-Type": saved.content_type ?? "application/json", "Idempotency-Replayed": "true" },
    });
  }

  await next();

  // Errors thrown by the handler have already been turned into a response by app.onError.
  // Server errors are not remembered, so the client can retry them with the same key.
  if (c.res.status >= 500) {
    await pool.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2", [userId, key]);
    return;
  }
  const responseBody = await c.res.clone().text();
  await pool.query(
    `UPDATE idempotency_keys SET status_code = $3, response_body = $4, content_type = $5
     WHERE user_id = $1 AND key = $2`,
    [userId, key, c.res.status, responseBody, c.res.headers.get("Content-Type")],
  );
};
