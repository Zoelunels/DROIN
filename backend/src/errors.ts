import type { Context, ErrorHandler } from "hono";

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 502 | 503;

// An error thrown on purpose from a route, carrying its HTTP status.
export class HttpError extends Error {
  constructor(public status: ErrorStatus, message: string) {
    super(message);
  }
}

// Installed with app.onError — Hono forwards every error thrown by a handler here.
export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message }, err.status);
  }

  // Postgres error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
  const code = (err as { code?: string }).code;
  if (code === "23503") {
    return c.json({ error: "This item is still used by other data" }, 409);
  }
  if (code === "23505") {
    return c.json({ error: "This item already exists" }, 409);
  }

  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
};

// Read a JSON body. An empty or malformed body → 400 (not 500).
export async function readJson(c: Context): Promise<any> {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError(400, "Body must be valid JSON");
  }
}
