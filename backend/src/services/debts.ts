import type { PoolClient } from "pg";
import { assertActive, lockWallets } from "../balance";
import { HttpError } from "../errors";
import type { TransactionType } from "../validate";
import { deleteTransactionRow, insertTransaction } from "./transactions";

// Debts and loans, shared by /debts and split bills (where each friend's share is a receivable).
//   payable    = I owe someone (I borrowed)  → borrowing puts money IN a wallet, repaying takes it OUT
//   receivable = someone owes me (I lent)    → lending takes money OUT of a wallet, being repaid puts it IN
// Money movements are transactions with origin 'debt' and no category, so they never count as
// income or expense in reports. Every function here runs inside the caller's DB transaction.

export type Direction = "payable" | "receivable";
export const DIRECTIONS: readonly Direction[] = ["payable", "receivable"];

export function openingType(direction: Direction): TransactionType {
  return direction === "payable" ? "income" : "expense";
}
export function paymentType(direction: Direction): TransactionType {
  return direction === "payable" ? "expense" : "income";
}

export async function lockDebt(client: PoolClient, userId: number, id: number) {
  const { rows } = await client.query("SELECT * FROM debts WHERE id = $1 AND user_id = $2 FOR UPDATE", [id, userId]);
  if (rows.length === 0) throw new HttpError(404, "Debt not found");
  return rows[0];
}

// Keep settled_at in sync with the payments.
export async function refreshSettled(client: PoolClient, debtId: number): Promise<void> {
  await client.query(
    `UPDATE debts d SET settled_at = CASE
       WHEN (SELECT COALESCE(SUM(amount), 0) FROM debt_payments WHERE debt_id = d.id) >= d.amount
         THEN COALESCE(d.settled_at, now())
       ELSE NULL END
     WHERE d.id = $1`,
    [debtId],
  );
}

export interface NewDebt {
  direction: Direction;
  counterparty: string;
  amount: number;
  debtDate: string;
  dueDate: string | null;
  note: string | null;
  walletId: number | null; // null: just the record, no money moves
  friendId?: number | null;
  /** Text of the money movement in the wallet; default "Lent to Budi" / "Borrowed from Budi". */
  movementNote?: string;
}

/** Records a debt (and, with a wallet, the money that moved). Returns its id. */
export async function createDebt(client: PoolClient, userId: number, d: NewDebt): Promise<number> {
  let openingTxId: number | null = null;
  if (d.walletId !== null) {
    assertActive(await lockWallets(client, userId, [d.walletId]), [d.walletId]);
    openingTxId = await insertTransaction(client, {
      userId, walletId: d.walletId, categoryId: null, type: openingType(d.direction), amount: d.amount,
      note: d.movementNote ?? `${d.direction === "payable" ? "Borrowed from" : "Lent to"} ${d.counterparty}`,
      transactionDate: d.debtDate, origin: "debt",
    });
  }
  const { rows } = await client.query(
    `INSERT INTO debts (user_id, direction, counterparty, amount, debt_date, due_date, note, wallet_id, opening_transaction_id, friend_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [userId, d.direction, d.counterparty, d.amount, d.debtDate, d.dueDate, d.note, d.walletId, openingTxId, d.friendId ?? null],
  );
  return rows[0].id;
}

/** Deletes a debt and undoes every balance change it caused (opening + repayments). */
export async function deleteDebt(client: PoolClient, userId: number, id: number): Promise<void> {
  const old = await lockDebt(client, userId, id);
  const payments = await client.query("SELECT wallet_id, transaction_id FROM debt_payments WHERE debt_id = $1", [id]);
  const walletIds = [old.wallet_id, ...payments.rows.map((p) => p.wallet_id)].filter((w): w is number => w !== null);
  if (walletIds.length > 0) await lockWallets(client, userId, walletIds);

  // Delete the rows that reference the transactions first (FKs), then the transactions.
  await client.query("DELETE FROM debt_payments WHERE debt_id = $1", [id]);
  await client.query("DELETE FROM debts WHERE id = $1", [id]);
  for (const txId of [old.opening_transaction_id, ...payments.rows.map((p) => p.transaction_id)]) {
    if (txId) await deleteTransactionRow(client, txId);
  }
}

export interface NewPayment {
  amount: number;
  paymentDate: string;
  walletId: number | null;
  note: string | null;
}

/** Records a repayment (with a wallet: the money moving back). Can't go past what is left. */
export async function addPayment(client: PoolClient, userId: number, id: number, p: NewPayment): Promise<void> {
  const old = await lockDebt(client, userId, id);
  const paid = await client.query("SELECT COALESCE(SUM(amount), 0) AS paid FROM debt_payments WHERE debt_id = $1", [id]);
  const remaining = Math.round((old.amount - paid.rows[0].paid) * 100) / 100;
  if (remaining <= 0) throw new HttpError(409, "This debt is already settled");
  if (p.amount > remaining) throw new HttpError(400, `amount is more than what is left (${remaining})`);

  let txId: number | null = null;
  if (p.walletId !== null) {
    assertActive(await lockWallets(client, userId, [p.walletId]), [p.walletId]);
    txId = await insertTransaction(client, {
      userId, walletId: p.walletId, categoryId: null, type: paymentType(old.direction), amount: p.amount,
      note: `${old.direction === "payable" ? "Repaid" : "Repayment from"} ${old.counterparty}`,
      transactionDate: p.paymentDate, origin: "debt",
    });
  }
  await client.query(
    `INSERT INTO debt_payments (user_id, debt_id, amount, payment_date, note, wallet_id, transaction_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, id, p.amount, p.paymentDate, p.note, p.walletId, txId],
  );
  await refreshSettled(client, id);
  await client.query("UPDATE debts SET updated_at = now() WHERE id = $1", [id]);
}

/** What is still owed on a debt. */
export async function remainingOf(client: PoolClient, id: number): Promise<number> {
  const { rows } = await client.query(
    `SELECT d.amount - COALESCE((SELECT SUM(amount) FROM debt_payments WHERE debt_id = d.id), 0) AS remaining
     FROM debts d WHERE d.id = $1`,
    [id],
  );
  return Math.max(0, Math.round((rows[0]?.remaining ?? 0) * 100) / 100);
}
