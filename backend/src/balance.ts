import type { PoolClient } from "pg";
import { HttpError } from "./errors";
import type { TransactionType } from "./validate";

export interface LockedWallet {
  id: number;
  name: string;
  archived_at: Date | null;
}

// Lock the wallet rows (FOR UPDATE) BEFORE changing a balance, always ordered by id.
// Why ordered? If transfers A→B and B→A run at the same time without a fixed order,
// request 1 holds A and waits for B while request 2 holds B and waits for A → deadlock.
// With the same id order the second request simply waits until the first one finishes.
// It doubles as an existence + ownership check: 400 if a wallet is missing or not the user's.
export async function lockWallets(
  client: PoolClient,
  userId: number,
  walletIds: number[],
): Promise<Map<number, LockedWallet>> {
  const ids = [...new Set(walletIds)].sort((a, b) => a - b);
  const { rows } = await client.query<LockedWallet>(
    "SELECT id, name, archived_at FROM wallets WHERE id = ANY($1) AND user_id = $2 ORDER BY id FOR UPDATE",
    [ids, userId],
  );
  const found = new Map(rows.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) throw new HttpError(400, `Wallet not found: ${missing.join(", ")}`);
  return found;
}

// Archived wallets keep their history but cannot receive new money movements.
export function assertActive(wallets: Map<number, LockedWallet>, walletIds: number[]): void {
  for (const id of walletIds) {
    const wallet = wallets.get(id);
    if (wallet?.archived_at) throw new HttpError(400, `Wallet "${wallet.name}" is archived`);
  }
}

// Apply a transaction's effect to a wallet balance.
//   direction = 1  → the transaction is added (income adds, expense subtracts)
//   direction = -1 → the transaction is undone (the opposite), used when editing/deleting
// Must run inside a DB transaction (withTransaction), after lockWallets.
// The arithmetic happens in SQL (NUMERIC) to avoid JS floating-point issues.
export async function applyToBalance(
  client: PoolClient,
  walletId: number,
  type: TransactionType,
  amount: number | string,
  direction: 1 | -1,
): Promise<void> {
  const { rowCount } = await client.query(
    `UPDATE wallets
     SET balance = balance + (CASE WHEN $2 = 'income' THEN $3::numeric ELSE -$3::numeric END) * $4
     WHERE id = $1`,
    [walletId, type, amount, direction],
  );
  if (rowCount === 0) throw new Error(`Wallet ${walletId} disappeared while updating its balance`);
}
