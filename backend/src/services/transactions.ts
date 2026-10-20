import type { PoolClient } from "pg";
import { applyToBalance, assertActive, lockWallets } from "../balance";
import type { Db } from "../db";
import { HttpError } from "../errors";
import { optionalString, parseId, requireAmount, requireDate, requireType, type TransactionType } from "../validate";
import { checkCategory } from "./categories";
import { parseTagNames, setTransactionTags } from "./tags";

export type TransactionOrigin = "manual" | "transfer" | "transfer_fee" | "debt";

// Columns returned to the client: the transaction + wallet/category names, its tags,
// how many receipts are attached, and which transfer/debt it belongs to (if any).
export const SELECT_TRANSACTION = `
  SELECT t.*,
         w.name AS wallet_name,
         c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
         tr.id AS transfer_id,
         COALESCE(d.id, dp.debt_id) AS debt_id,
         COALESCE((
           SELECT json_agg(json_build_object('id', g.id, 'name', g.name, 'color', g.color) ORDER BY lower(g.name))
           FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id
           WHERE tt.transaction_id = t.id
         ), '[]'::json) AS tags,
         (SELECT count(*)::int FROM attachments a WHERE a.transaction_id = t.id) AS attachment_count
  FROM transactions t
  JOIN wallets w ON w.id = t.wallet_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN transfers tr
    ON tr.from_transaction_id = t.id OR tr.to_transaction_id = t.id OR tr.fee_transaction_id = t.id
  LEFT JOIN debts d ON d.opening_transaction_id = t.id
  LEFT JOIN debt_payments dp ON dp.transaction_id = t.id
`;

export async function fetchTransaction(db: Db, userId: number, id: number) {
  const { rows } = await db.query(`${SELECT_TRANSACTION} WHERE t.id = $1 AND t.user_id = $2`, [id, userId]);
  if (rows.length === 0) throw new HttpError(404, "Transaction not found");
  return rows[0];
}

// A raw row write used by everything that moves money (manual transactions, transfers, debts).
// The caller must already hold the wallet lock (lockWallets).
export interface TransactionRow {
  userId: number;
  walletId: number;
  categoryId: number | null;
  type: TransactionType;
  amount: number;
  note: string | null;
  transactionDate: string;
  origin: TransactionOrigin;
  recurringRuleId?: number | null;
}

export async function insertTransaction(client: PoolClient, row: TransactionRow): Promise<number> {
  const { rows } = await client.query(
    `INSERT INTO transactions
       (user_id, wallet_id, category_id, type, amount, note, transaction_date, origin, recurring_rule_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      row.userId, row.walletId, row.categoryId, row.type, row.amount, row.note, row.transactionDate,
      row.origin, row.recurringRuleId ?? null,
    ],
  );
  await applyToBalance(client, row.walletId, row.type, row.amount, 1);
  return rows[0].id;
}

// Undo a stored transaction's balance effect and delete it (caller holds the wallet lock).
export async function deleteTransactionRow(client: PoolClient, id: number): Promise<void> {
  const { rows } = await client.query("DELETE FROM transactions WHERE id = $1 RETURNING wallet_id, type, amount", [id]);
  const old = rows[0];
  if (old) await applyToBalance(client, old.wallet_id, old.type, old.amount, -1);
}

// Change amount/date/note/wallet of a stored transaction, keeping balances right
// (undo the old effect, apply the new one). Caller holds locks on both old and new wallet.
export async function updateTransactionRow(
  client: PoolClient,
  id: number,
  changes: { walletId: number; amount: number; note: string | null; transactionDate: string },
): Promise<void> {
  const { rows } = await client.query("SELECT wallet_id, type, amount FROM transactions WHERE id = $1", [id]);
  const old = rows[0];
  await applyToBalance(client, old.wallet_id, old.type, old.amount, -1);
  await client.query(
    "UPDATE transactions SET wallet_id = $1, amount = $2, note = $3, transaction_date = $4 WHERE id = $5",
    [changes.walletId, changes.amount, changes.note, changes.transactionDate, id],
  );
  await applyToBalance(client, changes.walletId, old.type, changes.amount, 1);
}

// ---------- manual income/expense (POST/PUT /transactions, recurring rules) ----------

export interface ManualTransactionInput {
  walletId: number;
  categoryId: number;
  type: TransactionType;
  amount: number;
  note: string | null;
  transactionDate: string;
  tags?: string[]; // undefined = leave tags unchanged
}

export function parseManualInput(body: any): ManualTransactionInput {
  return {
    walletId: parseId(body?.wallet_id, "wallet_id"),
    // A normal transaction always has a category; NULL is reserved for transfers and debts.
    categoryId: parseId(body?.category_id, "category_id"),
    type: requireType(body?.type),
    amount: requireAmount(body?.amount),
    note: optionalString(body?.note, "note"),
    transactionDate: requireDate(body?.transaction_date, "transaction_date"),
    tags: parseTagNames(body?.tags),
  };
}

export async function createManualTransaction(
  client: PoolClient,
  userId: number,
  input: ManualTransactionInput,
  { recurringRuleId = null as number | null, allowArchived = false } = {},
): Promise<number> {
  const wallets = await lockWallets(client, userId, [input.walletId]);
  if (!allowArchived) assertActive(wallets, [input.walletId]);
  await checkCategory(client, userId, input.categoryId, input.type, { allowArchived });

  const id = await insertTransaction(client, {
    userId, walletId: input.walletId, categoryId: input.categoryId, type: input.type, amount: input.amount,
    note: input.note, transactionDate: input.transactionDate, origin: "manual", recurringRuleId,
  });
  if (input.tags && input.tags.length > 0) await setTransactionTags(client, userId, id, input.tags);
  return id;
}

// Lock a transaction row (FOR UPDATE) until the DB transaction ends, so it cannot be edited or
// deleted concurrently. Only manual transactions are editable here.
export async function lockManualTransaction(client: PoolClient, userId: number, id: number) {
  const { rows } = await client.query("SELECT * FROM transactions WHERE id = $1 AND user_id = $2 FOR UPDATE", [
    id,
    userId,
  ]);
  const tx = rows[0];
  if (!tx) throw new HttpError(404, "Transaction not found");
  if (tx.origin === "transfer" || tx.origin === "transfer_fee") {
    throw new HttpError(409, "This transaction belongs to a transfer, change it through /transfers");
  }
  if (tx.origin === "debt") {
    throw new HttpError(409, "This transaction belongs to a debt, change it through /debts");
  }
  return tx;
}

// Edit = undo the old balance effect, then apply the new one.
// That is automatically correct when the wallet, type or amount changes too.
export async function updateManualTransaction(
  client: PoolClient,
  userId: number,
  id: number,
  input: ManualTransactionInput,
): Promise<void> {
  const old = await lockManualTransaction(client, userId, id);
  const wallets = await lockWallets(client, userId, [old.wallet_id, input.walletId]);
  // Moving an old entry is fine; moving it INTO an archived wallet is not.
  if (input.walletId !== old.wallet_id) assertActive(wallets, [input.walletId]);
  await checkCategory(client, userId, input.categoryId, input.type, {
    allowArchived: input.categoryId === old.category_id,
  });

  await applyToBalance(client, old.wallet_id, old.type, old.amount, -1);
  await client.query(
    `UPDATE transactions
     SET wallet_id = $1, category_id = $2, type = $3, amount = $4, note = $5, transaction_date = $6
     WHERE id = $7`,
    [input.walletId, input.categoryId, input.type, input.amount, input.note, input.transactionDate, id],
  );
  await applyToBalance(client, input.walletId, input.type, input.amount, 1);
  if (input.tags !== undefined) await setTransactionTags(client, userId, id, input.tags);
}

// Returns the stored file names of the deleted transaction's receipts, so the caller can
// remove them from disk after the DB transaction has committed.
export async function deleteManualTransaction(client: PoolClient, userId: number, id: number): Promise<string[]> {
  const old = await lockManualTransaction(client, userId, id);
  await lockWallets(client, userId, [old.wallet_id]);
  const files = await client.query("SELECT stored_name FROM attachments WHERE transaction_id = $1", [id]);
  await deleteTransactionRow(client, id);
  return files.rows.map((r) => r.stored_name);
}
