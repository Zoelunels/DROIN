import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { pool, withTransaction } from "../db";
import { HttpError, readJson } from "../errors";
import { createFilters } from "../query";
import { removeStoredFiles } from "../services/attachments";
import {
  SELECT_TRANSACTION,
  createManualTransaction,
  deleteManualTransaction,
  fetchTransaction,
  parseManualInput,
  updateManualTransaction,
} from "../services/transactions";
import { parseId, requireDate, requireEnum, requireType } from "../validate";

export const transactionsRouter = new Hono<AppEnv>();

const ORIGINS = ["manual", "transfer", "transfer_fee", "debt"] as const;

// GET /transactions?wallet_id=&category_id=&type=&from=&to=&q=&tag=&origin=&limit=&offset=
//   q    searches the note and the category name
//   tag  a tag name (case-insensitive)
// The total number of matches (ignoring limit/offset) is in the X-Total-Count header.
transactionsRouter.get("/", async (c) => {
  const q = c.req.query();
  const filters = createFilters();
  filters.add("t.user_id = ?", c.get("user").id);
  if (q.wallet_id !== undefined) filters.add("t.wallet_id = ?", parseId(q.wallet_id, "wallet_id"));
  if (q.category_id !== undefined) filters.add("t.category_id = ?", parseId(q.category_id, "category_id"));
  if (q.type !== undefined) filters.add("t.type = ?", requireType(q.type));
  if (q.from !== undefined) filters.add("t.transaction_date >= ?", requireDate(q.from, "from"));
  if (q.to !== undefined) filters.add("t.transaction_date <= ?", requireDate(q.to, "to"));
  if (q.origin !== undefined) filters.add("t.origin = ?", requireEnum(q.origin, "origin", ORIGINS));
  if (q.q !== undefined && q.q.trim() !== "") {
    // Escape LIKE wildcards so "50%" searches for the literal text.
    const pattern = `%${q.q.trim().replace(/[\\%_]/g, "\\$&")}%`;
    filters.add("(t.note ILIKE ? OR c.name ILIKE ?)", pattern);
  }
  if (q.tag !== undefined && q.tag.trim() !== "") {
    filters.add(
      `EXISTS (SELECT 1 FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id
               WHERE tt.transaction_id = t.id AND lower(g.name) = lower(?))`,
      q.tag.trim().replace(/^#+/, ""),
    );
  }

  const page = filters.paginate(q);
  const [list, count] = await Promise.all([
    pool.query(
      `${SELECT_TRANSACTION} ${filters.where()}
       ORDER BY t.transaction_date DESC, t.id DESC
       ${page.sql}`,
      page.params,
    ),
    pool.query(
      `SELECT count(*)::int AS total
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       ${filters.where()}`,
      filters.params,
    ),
  ]);
  c.header("X-Total-Count", String(count.rows[0].total));
  return c.json(list.rows);
});

transactionsRouter.get("/:id", async (c) => {
  return c.json(await fetchTransaction(pool, c.get("user").id, parseId(c.req.param("id"))));
});

// Insert the transaction + update the wallet balance in 1 DB transaction:
// if either fails, both are rolled back.
// Body: wallet_id, category_id, type, amount, transaction_date, note?, tags? (list of names)
transactionsRouter.post("/", async (c) => {
  const userId = c.get("user").id;
  const input = parseManualInput(await readJson(c));
  const created = await withTransaction(async (client) => {
    const id = await createManualTransaction(client, userId, input);
    return fetchTransaction(client, userId, id);
  });
  return c.json(created, 201);
});

// Full replace. Leaving out `tags` keeps the current tags; `tags: []` removes them all.
transactionsRouter.put("/:id", async (c) => {
  const userId = c.get("user").id;
  const id = parseId(c.req.param("id"));
  const input = parseManualInput(await readJson(c));
  const updated = await withTransaction(async (client) => {
    await updateManualTransaction(client, userId, id, input);
    return fetchTransaction(client, userId, id);
  });
  return c.json(updated);
});

transactionsRouter.delete("/:id", async (c) => {
  const userId = c.get("user").id;
  const id = parseId(c.req.param("id"));
  const files = await withTransaction((client) => deleteManualTransaction(client, userId, id));
  // Only remove the receipt files once the DB delete has really committed.
  await removeStoredFiles(files);
  return c.body(null, 204);
});
