import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { pool } from "../db";
import { HttpError } from "../errors";
import { SELECT_TRANSACTION } from "../services/transactions";

export const syncRouter = new Hono<AppEnv>();

// Tables an offline phone keeps a copy of. Each has user_id + updated_at (bumped by a trigger).
const TABLES = [
  "wallets", "categories", "transfers", "budgets", "recurring_rules",
  "goals", "goal_contributions", "debts", "debt_payments", "tags", "attachments",
  "friends", "splits", "split_people",
] as const;

// A transaction that commits slightly after another one can carry an older updated_at.
// Re-sending everything from a small window before `since` covers that; the client upserts by id,
// so receiving a row twice is harmless.
const OVERLAP_SECONDS = 30;

// GET /sync/changes?since=<server_time from the previous call>
//   without since → a full snapshot (first launch / reinstall)
//   with since    → only rows created/changed after it, plus `deleted` tombstones
// Store the returned server_time and send it as `since` next time.
syncRouter.get("/changes", async (c) => {
  const userId = c.get("user").id;
  const sinceParam = c.req.query("since");
  let since: Date | null = null;
  if (sinceParam !== undefined) {
    since = new Date(sinceParam);
    if (Number.isNaN(since.getTime())) throw new HttpError(400, "since must be an ISO timestamp, e.g. 2026-10-09T08:00:00.000Z");
  }

  const serverTime = (await pool.query("SELECT now() AS now")).rows[0].now as Date;
  const params: unknown[] = [userId];
  let changed = "";
  if (since) {
    params.push(new Date(since.getTime() - OVERLAP_SECONDS * 1000));
    changed = "AND updated_at > $2";
  }

  const result: Record<string, unknown> = { server_time: serverTime.toISOString(), full: since === null };
  for (const table of TABLES) {
    // stored_name is an internal file name; the app downloads receipts via /attachments/:id.
    const columns = table === "attachments" ? "id, user_id, transaction_id, original_name, mime_type, size_bytes, created_at, updated_at" : "*";
    const { rows } = await pool.query(`SELECT ${columns} FROM ${table} WHERE user_id = $1 ${changed} ORDER BY id`, params);
    result[table] = rows;
  }
  const transactions = await pool.query(
    `${SELECT_TRANSACTION} WHERE t.user_id = $1 ${changed.replace("updated_at", "t.updated_at")} ORDER BY t.id`,
    params,
  );
  result.transactions = transactions.rows;

  result.deleted = since
    ? (
        await pool.query(
          "SELECT entity, entity_id AS id, deleted_at FROM deletions WHERE user_id = $1 AND deleted_at > $2 ORDER BY id",
          params,
        )
      ).rows
    : [];

  return c.json(result);
});
