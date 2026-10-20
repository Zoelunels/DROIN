import { Hono } from "hono";
import type { PoolClient } from "pg";
import type { AppEnv } from "../auth";
import { assertActive, lockWallets } from "../balance";
import { pool, withTransaction } from "../db";
import { HttpError, readJson } from "../errors";
import { createFilters } from "../query";
import { getSystemCategoryId } from "../services/categories";
import { deleteTransactionRow, insertTransaction, updateTransactionRow } from "../services/transactions";
import { optionalAmount, optionalString, parseId, requireAmount, requireDate } from "../validate";

export const transfersRouter = new Hono<AppEnv>();

const SELECT_TRANSFER = `
  SELECT tf.*, fw.name AS from_wallet_name, tw.name AS to_wallet_name
  FROM transfers tf
  JOIN wallets fw ON fw.id = tf.from_wallet_id
  JOIN wallets tw ON tw.id = tf.to_wallet_id
`;

interface TransferInput {
  fromWalletId: number;
  toWalletId: number;
  amount: number;
  fee: number;
  transferDate: string;
  note: string | null;
}

function parseInput(body: any): TransferInput {
  const input = {
    fromWalletId: parseId(body?.from_wallet_id, "from_wallet_id"),
    toWalletId: parseId(body?.to_wallet_id, "to_wallet_id"),
    amount: requireAmount(body?.amount),
    // Bank-to-bank admin fee, paid by the sending wallet on top of the amount.
    fee: optionalAmount(body?.fee, "fee"),
    transferDate: requireDate(body?.transfer_date, "transfer_date"),
    note: optionalString(body?.note, "note"),
  };
  // Also guarded by a CHECK in the DB, but checked here for a clear 400 instead of a 500.
  if (input.fromWalletId === input.toWalletId) {
    throw new HttpError(400, "from_wallet_id and to_wallet_id must be different");
  }
  return input;
}

async function fetchTransfer(db: PoolClient | typeof pool, userId: number, id: number) {
  const { rows } = await db.query(`${SELECT_TRANSFER} WHERE tf.id = $1 AND tf.user_id = $2`, [id, userId]);
  if (rows.length === 0) throw new HttpError(404, "Transfer not found");
  return rows[0];
}

async function lockTransfer(client: PoolClient, userId: number, id: number) {
  const { rows } = await client.query("SELECT * FROM transfers WHERE id = $1 AND user_id = $2 FOR UPDATE", [id, userId]);
  if (rows.length === 0) throw new HttpError(404, "Transfer not found");
  return rows[0];
}

function feeNote(toWalletName: string): string {
  return `Transfer fee to ${toWalletName}`;
}

// GET /transfers?wallet_id=&from=&to=&limit=&offset=
// wallet_id matches when the wallet is either the sender OR the receiver.
transfersRouter.get("/", async (c) => {
  const q = c.req.query();
  const filters = createFilters();
  filters.add("tf.user_id = ?", c.get("user").id);
  if (q.wallet_id !== undefined) {
    filters.add("(tf.from_wallet_id = ? OR tf.to_wallet_id = ?)", parseId(q.wallet_id, "wallet_id"));
  }
  if (q.from !== undefined) filters.add("tf.transfer_date >= ?", requireDate(q.from, "from"));
  if (q.to !== undefined) filters.add("tf.transfer_date <= ?", requireDate(q.to, "to"));

  const page = filters.paginate(q);
  const [list, count] = await Promise.all([
    pool.query(`${SELECT_TRANSFER} ${filters.where()} ORDER BY tf.transfer_date DESC, tf.id DESC ${page.sql}`, page.params),
    pool.query(`SELECT count(*)::int AS total FROM transfers tf ${filters.where()}`, filters.params),
  ]);
  c.header("X-Total-Count", String(count.rows[0].total));
  return c.json(list.rows);
});

transfersRouter.get("/:id", async (c) => {
  return c.json(await fetchTransfer(pool, c.get("user").id, parseId(c.req.param("id"))));
});

// A transfer = 2 transactions (expense in from_wallet, income in to_wallet, no category so they
// never count as income/expense) + optionally a fee expense in from_wallet ("Admin Fees" category)
// + 1 transfers row pointing at them. All in 1 DB transaction: one fails, everything rolls back.
transfersRouter.post("/", async (c) => {
  const userId = c.get("user").id;
  const input = parseInput(await readJson(c));

  const created = await withTransaction(async (client) => {
    const wallets = await lockWallets(client, userId, [input.fromWalletId, input.toWalletId]);
    assertActive(wallets, [input.fromWalletId, input.toWalletId]);

    const base = { userId, categoryId: null, amount: input.amount, note: input.note, transactionDate: input.transferDate, origin: "transfer" as const };
    const fromTxId = await insertTransaction(client, { ...base, walletId: input.fromWalletId, type: "expense" });
    const toTxId = await insertTransaction(client, { ...base, walletId: input.toWalletId, type: "income" });
    const feeTxId = input.fee > 0
      ? await insertTransaction(client, {
          userId, walletId: input.fromWalletId, categoryId: await getSystemCategoryId(client, userId, "transfer_fee"),
          type: "expense", amount: input.fee, note: feeNote(wallets.get(input.toWalletId)!.name),
          transactionDate: input.transferDate, origin: "transfer_fee",
        })
      : null;

    const { rows } = await client.query(
      `INSERT INTO transfers
         (user_id, from_wallet_id, to_wallet_id, amount, fee, transfer_date, note,
          from_transaction_id, to_transaction_id, fee_transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [userId, input.fromWalletId, input.toWalletId, input.amount, input.fee, input.transferDate, input.note, fromTxId, toTxId, feeTxId],
    );
    return fetchTransfer(client, userId, rows[0].id);
  });

  return c.json(created, 201);
});

// Edit a transfer: update both transactions (each undoes its old balance effect and applies the
// new one), then add/update/remove the fee transaction as needed.
transfersRouter.put("/:id", async (c) => {
  const userId = c.get("user").id;
  const id = parseId(c.req.param("id"));
  const input = parseInput(await readJson(c));

  const updated = await withTransaction(async (client) => {
    const old = await lockTransfer(client, userId, id);
    const wallets = await lockWallets(client, userId, [old.from_wallet_id, old.to_wallet_id, input.fromWalletId, input.toWalletId]);
    assertActive(
      wallets,
      [input.fromWalletId, input.toWalletId].filter((w) => w !== old.from_wallet_id && w !== old.to_wallet_id),
    );

    const common = { amount: input.amount, note: input.note, transactionDate: input.transferDate };
    await updateTransactionRow(client, old.from_transaction_id, { ...common, walletId: input.fromWalletId });
    await updateTransactionRow(client, old.to_transaction_id, { ...common, walletId: input.toWalletId });

    let feeTxId: number | null = old.fee_transaction_id;
    const note = feeNote(wallets.get(input.toWalletId)!.name);
    if (input.fee > 0 && feeTxId) {
      await updateTransactionRow(client, feeTxId, { walletId: input.fromWalletId, amount: input.fee, note, transactionDate: input.transferDate });
    } else if (input.fee > 0) {
      feeTxId = await insertTransaction(client, {
        userId, walletId: input.fromWalletId, categoryId: await getSystemCategoryId(client, userId, "transfer_fee"),
        type: "expense", amount: input.fee, note, transactionDate: input.transferDate, origin: "transfer_fee",
      });
    }

    await client.query(
      `UPDATE transfers
       SET from_wallet_id = $1, to_wallet_id = $2, amount = $3, fee = $4, transfer_date = $5, note = $6,
           fee_transaction_id = $7
       WHERE id = $8`,
      [input.fromWalletId, input.toWalletId, input.amount, input.fee, input.transferDate, input.note, input.fee > 0 ? feeTxId : null, id],
    );
    // The fee was removed: delete its transaction after the transfer no longer points at it.
    if (input.fee === 0 && old.fee_transaction_id) await deleteTransactionRow(client, old.fee_transaction_id);

    return fetchTransfer(client, userId, id);
  });

  return c.json(updated);
});

transfersRouter.delete("/:id", async (c) => {
  const userId = c.get("user").id;
  const id = parseId(c.req.param("id"));

  await withTransaction(async (client) => {
    const old = await lockTransfer(client, userId, id);
    await lockWallets(client, userId, [old.from_wallet_id, old.to_wallet_id]);
    // Delete the transfers row first, because it references (FK) the transactions.
    await client.query("DELETE FROM transfers WHERE id = $1", [id]);
    for (const txId of [old.from_transaction_id, old.to_transaction_id, old.fee_transaction_id]) {
      if (txId) await deleteTransactionRow(client, txId);
    }
  });

  return c.body(null, 204);
});
