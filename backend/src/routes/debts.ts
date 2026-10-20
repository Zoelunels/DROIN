import { Hono } from "hono";
import type { PoolClient } from "pg";
import type { AppEnv } from "../auth";
import { assertActive, lockWallets } from "../balance";
import { pool, withTransaction, type Db } from "../db";
import { HttpError, readJson } from "../errors";
import { deleteTransactionRow, insertTransaction, updateTransactionRow } from "../services/transactions";
import { todayIn } from "../time";
import {
  optionalDate,
  optionalId,
  optionalString,
  parseId,
  requireAmount,
  requireDate,
  requireEnum,
  requireString,
  type TransactionType,
} from "../validate";

// Debts and loans (hutang/piutang).
//   payable    = I owe someone (I borrowed)  → borrowing puts money IN a wallet, repaying takes it OUT
//   receivable = someone owes me (I lent)    → lending takes money OUT of a wallet, being repaid puts it IN
// wallet_id is optional everywhere: without it only the record is kept and no balance changes.
// Money movements are transactions with origin 'debt' and no category, so they never count as
// income or expense in reports.
export const debtsRouter = new Hono<AppEnv>();

type Direction = "payable" | "receivable";
const DIRECTIONS: readonly Direction[] = ["payable", "receivable"];

// Which way money moves for the opening (borrow/lend) and for repayments.
function openingType(direction: Direction): TransactionType {
  return direction === "payable" ? "income" : "expense";
}
function paymentType(direction: Direction): TransactionType {
  return direction === "payable" ? "expense" : "income";
}

const SELECT_DEBT = `
  SELECT d.*, w.name AS wallet_name,
         COALESCE((SELECT SUM(p.amount) FROM debt_payments p WHERE p.debt_id = d.id), 0) AS paid_amount
  FROM debts d LEFT JOIN wallets w ON w.id = d.wallet_id
`;

function withStatus(debt: any, today: string) {
  const remaining = Math.max(0, Math.round((debt.amount - debt.paid_amount) * 100) / 100);
  const status = remaining === 0 ? "settled" : debt.due_date && debt.due_date < today ? "overdue" : "open";
  return { ...debt, remaining, status };
}

async function fetchDebt(db: Db, userId: number, timezone: string, id: number) {
  const { rows } = await db.query(`${SELECT_DEBT} WHERE d.id = $1 AND d.user_id = $2`, [id, userId]);
  if (rows.length === 0) throw new HttpError(404, "Debt not found");
  const payments = await db.query(
    `SELECT p.*, w.name AS wallet_name FROM debt_payments p LEFT JOIN wallets w ON w.id = p.wallet_id
     WHERE p.debt_id = $1 ORDER BY p.payment_date, p.id`,
    [id],
  );
  return { ...withStatus(rows[0], todayIn(timezone)), payments: payments.rows };
}

async function lockDebt(client: PoolClient, userId: number, id: number) {
  const { rows } = await client.query("SELECT * FROM debts WHERE id = $1 AND user_id = $2 FOR UPDATE", [id, userId]);
  if (rows.length === 0) throw new HttpError(404, "Debt not found");
  return rows[0];
}

// Keep settled_at in sync with the payments.
async function refreshSettled(client: PoolClient, debtId: number): Promise<void> {
  await client.query(
    `UPDATE debts d SET settled_at = CASE
       WHEN (SELECT COALESCE(SUM(amount), 0) FROM debt_payments WHERE debt_id = d.id) >= d.amount
         THEN COALESCE(d.settled_at, now())
       ELSE NULL END
     WHERE d.id = $1`,
    [debtId],
  );
}

// GET /debts?direction=payable|receivable&status=open|settled|overdue
debtsRouter.get("/", async (c) => {
  const user = c.get("user");
  const q = c.req.query();
  const params: unknown[] = [user.id];
  let where = "WHERE d.user_id = $1";
  if (q.direction !== undefined) {
    params.push(requireEnum(q.direction, "direction", DIRECTIONS));
    where += ` AND d.direction = $${params.length}`;
  }
  const { rows } = await pool.query(`${SELECT_DEBT} ${where} ORDER BY d.settled_at NULLS FIRST, d.due_date NULLS LAST, d.id`, params);
  const today = todayIn(user.timezone);
  let debts = rows.map((d) => withStatus(d, today));
  if (q.status !== undefined) {
    const status = requireEnum(q.status, "status", ["open", "settled", "overdue"] as const);
    // "open" includes overdue ones: both still need to be paid.
    debts = debts.filter((d) => (status === "open" ? d.status !== "settled" : d.status === status));
  }
  return c.json(debts);
});

// GET /debts/summary — what I still owe vs what others still owe me.
debtsRouter.get("/summary", async (c) => {
  const user = c.get("user");
  const { rows } = await pool.query(`${SELECT_DEBT} WHERE d.user_id = $1`, [user.id]);
  const today = todayIn(user.timezone);
  const summary = { payable_remaining: 0, receivable_remaining: 0, open_count: 0, overdue_count: 0 };
  for (const d of rows.map((r) => withStatus(r, today))) {
    if (d.status === "settled") continue;
    summary.open_count++;
    if (d.status === "overdue") summary.overdue_count++;
    if (d.direction === "payable") summary.payable_remaining += d.remaining;
    else summary.receivable_remaining += d.remaining;
  }
  summary.payable_remaining = Math.round(summary.payable_remaining * 100) / 100;
  summary.receivable_remaining = Math.round(summary.receivable_remaining * 100) / 100;
  return c.json({ ...summary, net: Math.round((summary.receivable_remaining - summary.payable_remaining) * 100) / 100 });
});

debtsRouter.get("/:id", async (c) => {
  const user = c.get("user");
  return c.json(await fetchDebt(pool, user.id, user.timezone, parseId(c.req.param("id"))));
});

// POST /debts { direction, counterparty, amount, debt_date?, due_date?, note?, wallet_id? }
debtsRouter.post("/", async (c) => {
  const user = c.get("user");
  const body = await readJson(c);
  const direction = requireEnum(body?.direction, "direction", DIRECTIONS);
  const counterparty = requireString(body?.counterparty, "counterparty");
  const amount = requireAmount(body?.amount);
  const debtDate = body?.debt_date === undefined ? todayIn(user.timezone) : requireDate(body.debt_date, "debt_date");
  const dueDate = optionalDate(body?.due_date, "due_date");
  const note = optionalString(body?.note, "note");
  const walletId = optionalId(body?.wallet_id, "wallet_id");
  if (dueDate !== null && dueDate < debtDate) throw new HttpError(400, "due_date cannot be before debt_date");

  const debt = await withTransaction(async (client) => {
    let openingTxId: number | null = null;
    if (walletId !== null) {
      assertActive(await lockWallets(client, user.id, [walletId]), [walletId]);
      openingTxId = await insertTransaction(client, {
        userId: user.id, walletId, categoryId: null, type: openingType(direction), amount,
        note: `${direction === "payable" ? "Borrowed from" : "Lent to"} ${counterparty}`,
        transactionDate: debtDate, origin: "debt",
      });
    }
    const { rows } = await client.query(
      `INSERT INTO debts (user_id, direction, counterparty, amount, debt_date, due_date, note, wallet_id, opening_transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [user.id, direction, counterparty, amount, debtDate, dueDate, note, walletId, openingTxId],
    );
    return fetchDebt(client, user.id, user.timezone, rows[0].id);
  });
  return c.json(debt, 201);
});

// PUT /debts/:id { counterparty, amount, due_date?, note? }
// Direction, date and wallet are fixed — delete and re-create the debt to change those.
// The amount can't go below what was already repaid.
debtsRouter.put("/:id", async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const body = await readJson(c);
  const counterparty = requireString(body?.counterparty, "counterparty");
  const amount = requireAmount(body?.amount);
  const dueDate = optionalDate(body?.due_date, "due_date");
  const note = optionalString(body?.note, "note");

  const debt = await withTransaction(async (client) => {
    const old = await lockDebt(client, user.id, id);
    if (dueDate !== null && dueDate < old.debt_date) throw new HttpError(400, "due_date cannot be before debt_date");
    const paid = await client.query("SELECT COALESCE(SUM(amount), 0) AS paid FROM debt_payments WHERE debt_id = $1", [id]);
    if (amount < paid.rows[0].paid) throw new HttpError(400, "amount cannot be less than what was already repaid");

    if (old.opening_transaction_id) {
      await lockWallets(client, user.id, [old.wallet_id]);
      await updateTransactionRow(client, old.opening_transaction_id, {
        walletId: old.wallet_id, amount, transactionDate: old.debt_date,
        note: `${old.direction === "payable" ? "Borrowed from" : "Lent to"} ${counterparty}`,
      });
    }
    await client.query("UPDATE debts SET counterparty = $1, amount = $2, due_date = $3, note = $4 WHERE id = $5", [
      counterparty, amount, dueDate, note, id,
    ]);
    await refreshSettled(client, id);
    return fetchDebt(client, user.id, user.timezone, id);
  });
  return c.json(debt);
});

// Deleting a debt also undoes every balance change it caused (opening + repayments).
debtsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  await withTransaction(async (client) => {
    const old = await lockDebt(client, user.id, id);
    const payments = await client.query("SELECT wallet_id, transaction_id FROM debt_payments WHERE debt_id = $1", [id]);
    const walletIds = [old.wallet_id, ...payments.rows.map((p) => p.wallet_id)].filter((w): w is number => w !== null);
    if (walletIds.length > 0) await lockWallets(client, user.id, walletIds);

    // Delete the rows that reference the transactions first (FKs), then the transactions.
    await client.query("DELETE FROM debt_payments WHERE debt_id = $1", [id]);
    await client.query("DELETE FROM debts WHERE id = $1", [id]);
    for (const txId of [old.opening_transaction_id, ...payments.rows.map((p) => p.transaction_id)]) {
      if (txId) await deleteTransactionRow(client, txId);
    }
  });
  return c.body(null, 204);
});

// POST /debts/:id/payments { amount, payment_date?, wallet_id?, note? } → the updated debt
debtsRouter.post("/:id/payments", async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const body = await readJson(c);
  const amount = requireAmount(body?.amount);
  const paymentDate = body?.payment_date === undefined ? todayIn(user.timezone) : requireDate(body.payment_date, "payment_date");
  const walletId = optionalId(body?.wallet_id, "wallet_id");
  const note = optionalString(body?.note, "note");

  const debt = await withTransaction(async (client) => {
    const old = await lockDebt(client, user.id, id);
    const paid = await client.query("SELECT COALESCE(SUM(amount), 0) AS paid FROM debt_payments WHERE debt_id = $1", [id]);
    const remaining = Math.round((old.amount - paid.rows[0].paid) * 100) / 100;
    if (remaining <= 0) throw new HttpError(409, "This debt is already settled");
    if (amount > remaining) throw new HttpError(400, `amount is more than what is left (${remaining})`);

    let txId: number | null = null;
    if (walletId !== null) {
      assertActive(await lockWallets(client, user.id, [walletId]), [walletId]);
      txId = await insertTransaction(client, {
        userId: user.id, walletId, categoryId: null, type: paymentType(old.direction), amount,
        note: `${old.direction === "payable" ? "Repaid" : "Repayment from"} ${old.counterparty}`,
        transactionDate: paymentDate, origin: "debt",
      });
    }
    await client.query(
      `INSERT INTO debt_payments (user_id, debt_id, amount, payment_date, note, wallet_id, transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.id, id, amount, paymentDate, note, walletId, txId],
    );
    await refreshSettled(client, id);
    await client.query("UPDATE debts SET updated_at = now() WHERE id = $1", [id]);
    return fetchDebt(client, user.id, user.timezone, id);
  });
  return c.json(debt, 201);
});

debtsRouter.delete("/:id/payments/:paymentId", async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const paymentId = parseId(c.req.param("paymentId"), "paymentId");

  const debt = await withTransaction(async (client) => {
    await lockDebt(client, user.id, id);
    const { rows } = await client.query("SELECT * FROM debt_payments WHERE id = $1 AND debt_id = $2", [paymentId, id]);
    const payment = rows[0];
    if (!payment) throw new HttpError(404, "Payment not found");
    if (payment.wallet_id) await lockWallets(client, user.id, [payment.wallet_id]);
    await client.query("DELETE FROM debt_payments WHERE id = $1", [paymentId]);
    if (payment.transaction_id) await deleteTransactionRow(client, payment.transaction_id);
    await refreshSettled(client, id);
    await client.query("UPDATE debts SET updated_at = now() WHERE id = $1", [id]);
    return fetchDebt(client, user.id, user.timezone, id);
  });
  return c.json(debt);
});
