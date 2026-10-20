import { Pool, types, type PoolClient } from "pg";

// By default pg returns NUMERIC as a string ("150000.00") to preserve precision.
// For NUMERIC(15,2) (max 13 digits + 2 decimals) a JS number is still precise enough,
// so we convert to number and the mobile app does not have to parse strings.
// Balance arithmetic itself still happens in SQL, not in JS.
types.setTypeParser(types.builtins.NUMERIC, (value) => Number(value));

// DATE (no time) would otherwise become a JS Date at 00:00 local time, which turns into the
// previous day once serialized to UTC JSON (2026-09-24 → "2026-09-23T17:00:00Z" in WIB).
// Keep it as the plain string "YYYY-MM-DD".
types.setTypeParser(types.builtins.DATE, (value) => value);

// TIME stays "HH:MM:SS"; trim the seconds for the API ("20:00").
types.setTypeParser(types.builtins.TIME, (value) => value.slice(0, 5));

// Bun reads .env automatically, so dotenv is not needed.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export type Db = Pool | PoolClient;

// DB transaction helper: BEGIN -> fn -> COMMIT, or ROLLBACK if anything throws.
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
