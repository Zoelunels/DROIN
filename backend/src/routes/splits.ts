import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { pool, withTransaction } from "../db";
import { HttpError, readJson } from "../errors";
import { removeStoredFiles } from "../services/attachments";
import { addPayment, remainingOf } from "../services/debts";
import { createSplit, deleteSplit, fetchSplit, listSplits, parseSplitInput } from "../services/split";
import { todayIn } from "../time";
import { optionalId, parseId, requireDate, requireString } from "../validate";

// Split bills (see services/split.ts for how shares are worked out) and the friends picked in them.
//   GET    /splits                       newest first, with who still owes what
//   GET    /splits/:id
//   POST   /splits                       { title, total, split_date?, wallet_id, category_id, people, items }
//   POST   /splits/:id/people/:personId/paid   { wallet_id?, payment_date? }  that person paid you back
//   DELETE /splits/:id                   undoes the expense, the debts and any repayments
export const splitsRouter = new Hono<AppEnv>();

splitsRouter.get("/", async (c) => {
  const limit = c.req.query("limit") === undefined ? 50 : Math.min(parseId(c.req.query("limit"), "limit"), 200);
  return c.json(await listSplits(pool, c.get("user").id, limit));
});

splitsRouter.get("/:id", async (c) => {
  return c.json(await fetchSplit(pool, c.get("user").id, parseId(c.req.param("id"))));
});

// people: [{ name, me?: true, friend_id?, save_as_friend? }] — exactly one is you; a name without
//         friend_id is a guest unless save_as_friend is set (then it's added to /friends).
// items:  [{ name, amount, people: [position, …] }] — who had each item, by position in `people`.
// total:  what you paid. Tax, service and discounts (total ≠ items) are shared in proportion.
splitsRouter.post("/", async (c) => {
  const user = c.get("user");
  const input = parseSplitInput(await readJson(c), user.timezone);
  const split = await withTransaction(async (client) => {
    const id = await createSplit(client, user.id, input);
    return fetchSplit(client, user.id, id);
  });
  return c.json(split, 201);
});

// Someone paid back everything they still owe: the money goes into wallet_id (default: the wallet
// the bill was paid from). For part payments use POST /debts/:debt_id/payments.
splitsRouter.post("/:id/people/:personId/paid", async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const personId = parseId(c.req.param("personId"), "personId");
  const body = await readJson(c).catch(() => ({}));
  const walletOverride = optionalId(body?.wallet_id, "wallet_id");
  const paymentDate = body?.payment_date === undefined ? todayIn(user.timezone) : requireDate(body.payment_date, "payment_date");

  const split = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT p.debt_id, p.is_me, p.name, s.wallet_id FROM split_people p JOIN splits s ON s.id = p.split_id
       WHERE p.id = $1 AND p.split_id = $2 AND s.user_id = $3`,
      [personId, id, user.id],
    );
    const person = rows[0];
    if (!person) throw new HttpError(404, "Person not found in this split");
    if (person.is_me) throw new HttpError(400, "That's your own share");
    if (person.debt_id === null) throw new HttpError(409, `${person.name}'s debt was deleted`);
    const remaining = await remainingOf(client, person.debt_id);
    if (remaining <= 0) throw new HttpError(409, `${person.name} already paid you back`);
    await addPayment(client, user.id, person.debt_id, {
      amount: remaining, paymentDate, walletId: walletOverride ?? person.wallet_id, note: null,
    });
    return fetchSplit(client, user.id, id);
  });
  return c.json(split);
});

splitsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const files = await withTransaction((client) => deleteSplit(client, user.id, id));
  await removeStoredFiles(files);
  return c.body(null, 204);
});

// ---------- friends ----------

// GET /friends — with what each still owes you across all splits and debts.
export const friendsRouter = new Hono<AppEnv>();

friendsRouter.get("/", async (c) => {
  const { rows } = await pool.query(
    `SELECT f.id, f.name, f.created_at,
            COALESCE((
              SELECT SUM(d.amount - COALESCE((SELECT SUM(p.amount) FROM debt_payments p WHERE p.debt_id = d.id), 0))
              FROM debts d WHERE d.friend_id = f.id AND d.direction = 'receivable' AND d.settled_at IS NULL
            ), 0) AS owes_you
     FROM friends f WHERE f.user_id = $1 ORDER BY lower(f.name)`,
    [c.get("user").id],
  );
  return c.json(rows);
});

friendsRouter.post("/", async (c) => {
  const body = await readJson(c);
  const { rows } = await pool.query("INSERT INTO friends (user_id, name) VALUES ($1, $2) RETURNING id, name, created_at", [
    c.get("user").id,
    requireString(body?.name, "name", 60),
  ]);
  return c.json({ ...rows[0], owes_you: 0 }, 201);
});

friendsRouter.put("/:id", async (c) => {
  const body = await readJson(c);
  const { rows } = await pool.query("UPDATE friends SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING id, name, created_at", [
    requireString(body?.name, "name", 60),
    parseId(c.req.param("id")),
    c.get("user").id,
  ]);
  if (rows.length === 0) throw new HttpError(404, "Friend not found");
  return c.json(rows[0]);
});

// Their splits and debts stay (under the name they had); only the saved friend goes.
friendsRouter.delete("/:id", async (c) => {
  const { rowCount } = await pool.query("DELETE FROM friends WHERE id = $1 AND user_id = $2", [parseId(c.req.param("id")), c.get("user").id]);
  if (rowCount === 0) throw new HttpError(404, "Friend not found");
  return c.body(null, 204);
});
