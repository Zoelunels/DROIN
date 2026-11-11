import type { PoolClient } from "pg";
import { assertActive, lockWallets } from "../balance";
import type { Db } from "../db";
import { HttpError } from "../errors";
import { todayIn } from "../time";
import { optionalId, parseId, requireAmount, requireDate, requireString } from "../validate";
import { checkCategory } from "./categories";
import { createDebt, deleteDebt } from "./debts";
import { deleteTransactionRow, insertTransaction } from "./transactions";

// Split bills. The user paid the whole receipt; it is shared out by who had what:
//   - each item is split evenly between the people who had it,
//   - whatever the items don't cover (tax, service, discounts, rounding on the receipt) is spread in
//     proportion, so someone who ate twice as much also pays twice the tax,
//   - shares are whole rupiah and always add up to exactly what was paid.
// The user's own share is an expense in the chosen category; every friend's share is a receivable
// debt ("Budi owes you"), with the money taken from the same wallet, so the wallet drops by the full
// bill while only the user's part counts as spending.

export interface SplitItem {
  name: string;
  amount: number;
  people: number[]; // positions in the people list
}

/**
 * Each person's share of `total`, by position. Exact: the shares add up to `total`. Rounded to whole
 * rupiah when the total is whole, else to cents; leftover units go to the largest fractions.
 */
export function computeShares(total: number, items: SplitItem[], peopleCount: number): number[] {
  const itemsSum = items.reduce((s, i) => s + i.amount, 0);
  const base = new Array<number>(peopleCount).fill(0);
  for (const item of items) for (const p of item.people) base[p]! += item.amount / item.people.length;

  const totalCents = Math.round(total * 100);
  const unit = totalCents % 100 === 0 ? 100 : 1;
  const totalUnits = totalCents / unit;
  const exact = base.map((b) => (itemsSum > 0 ? (b / itemsSum) * totalUnits : 0));
  const units = exact.map(Math.floor);
  let left = totalUnits - units.reduce((s, u) => s + u, 0);
  // Largest remainders first; on a tie the earlier person (the payer is first) takes it.
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) units[order[k]!.i]!++;
  return units.map((u) => (u * unit) / 100);
}

export interface SplitPersonInput {
  name: string;
  me: boolean;
  friendId: number | null;
  saveAsFriend: boolean;
}

export interface SplitInput {
  title: string;
  total: number;
  splitDate: string;
  walletId: number;
  categoryId: number;
  people: SplitPersonInput[];
  items: SplitItem[];
}

const MAX_PEOPLE = 20;
const MAX_ITEMS = 100;

export function parseSplitInput(body: any, timezone: string): SplitInput {
  const rawPeople = body?.people;
  if (!Array.isArray(rawPeople) || rawPeople.length < 2) throw new HttpError(400, "A split needs you and at least one other person");
  if (rawPeople.length > MAX_PEOPLE) throw new HttpError(400, `A split can have at most ${MAX_PEOPLE} people`);
  const people: SplitPersonInput[] = rawPeople.map((p: any, i: number) => ({
    name: requireString(p?.name, `people[${i}].name`, 60),
    me: p?.me === true,
    friendId: optionalId(p?.friend_id, `people[${i}].friend_id`),
    saveAsFriend: p?.save_as_friend === true,
  }));
  if (people.filter((p) => p.me).length !== 1) throw new HttpError(400, "Exactly one person in a split is you (me: true)");
  const names = new Set<string>();
  for (const p of people) {
    const key = p.name.toLowerCase();
    if (names.has(key)) throw new HttpError(400, `"${p.name}" is in the split twice`);
    names.add(key);
  }

  const rawItems = body?.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new HttpError(400, "A split needs at least one item");
  if (rawItems.length > MAX_ITEMS) throw new HttpError(400, `A split can have at most ${MAX_ITEMS} items`);
  const items: SplitItem[] = rawItems.map((it: any, i: number) => {
    const who = it?.people;
    if (!Array.isArray(who) || who.length === 0) throw new HttpError(400, `Pick who had "${it?.name ?? `item ${i + 1}`}"`);
    const positions = [...new Set(who)];
    for (const p of positions) {
      if (!Number.isInteger(p) || p < 0 || p >= people.length) throw new HttpError(400, `items[${i}].people has an unknown person`);
    }
    return {
      name: requireString(it?.name, `items[${i}].name`, 100),
      amount: requireAmount(it?.amount, `items[${i}].amount`),
      people: positions as number[],
    };
  });

  const input: SplitInput = {
    title: requireString(body?.title, "title", 100),
    total: requireAmount(body?.total, "total"),
    splitDate: body?.split_date === undefined ? todayIn(timezone) : requireDate(body.split_date, "split_date"),
    walletId: parseId(body?.wallet_id, "wallet_id"),
    categoryId: parseId(body?.category_id, "category_id"),
    people,
    items,
  };
  // Everyone else must have had something, or they'd be in the split owing nothing.
  const shares = computeShares(input.total, input.items, people.length);
  people.forEach((p, i) => {
    if (!p.me && shares[i] === 0) throw new HttpError(400, `${p.name} isn't on any item. Pick what they had, or remove them`);
  });
  return input;
}

/** The friend's id for this person: the one given (if it's the user's), or a new/existing one by name. */
async function friendFor(client: PoolClient, userId: number, p: SplitPersonInput): Promise<number | null> {
  if (p.friendId !== null) {
    const { rows } = await client.query("SELECT id FROM friends WHERE id = $1 AND user_id = $2", [p.friendId, userId]);
    if (rows.length === 0) throw new HttpError(400, `Friend not found: ${p.name}`);
    return p.friendId;
  }
  if (!p.saveAsFriend) return null; // a guest: just a name on this split
  const { rows } = await client.query(
    `INSERT INTO friends (user_id, name) VALUES ($1, $2)
     ON CONFLICT (user_id, (lower(name))) DO UPDATE SET name = friends.name
     RETURNING id`,
    [userId, p.name],
  );
  return rows[0].id;
}

/** Saves the split: the user's share as an expense, everyone else's as a debt. Returns its id. */
export async function createSplit(client: PoolClient, userId: number, input: SplitInput): Promise<number> {
  assertActive(await lockWallets(client, userId, [input.walletId]), [input.walletId]);
  await checkCategory(client, userId, input.categoryId, "expense");
  const shares = computeShares(input.total, input.items, input.people.length);

  const meIndex = input.people.findIndex((p) => p.me);
  const myShare = shares[meIndex]!;
  const transactionId =
    myShare > 0
      ? await insertTransaction(client, {
          userId, walletId: input.walletId, categoryId: input.categoryId, type: "expense", amount: myShare,
          note: `${input.title} (your share of a split)`, transactionDate: input.splitDate, origin: "manual",
        })
      : null;

  const { rows } = await client.query(
    `INSERT INTO splits (user_id, title, total, split_date, wallet_id, category_id, transaction_id, items)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [userId, input.title, input.total, input.splitDate, input.walletId, input.categoryId, transactionId, JSON.stringify(input.items)],
  );
  const splitId: number = rows[0].id;

  for (let i = 0; i < input.people.length; i++) {
    const p = input.people[i]!;
    const friendId = p.me ? null : await friendFor(client, userId, p);
    const debtId = p.me
      ? null
      : await createDebt(client, userId, {
          direction: "receivable", counterparty: p.name, amount: shares[i]!, debtDate: input.splitDate, dueDate: null,
          note: `Split: ${input.title}`, walletId: input.walletId, friendId,
          movementNote: `${p.name}'s share of ${input.title}`,
        });
    await client.query(
      `INSERT INTO split_people (user_id, split_id, position, name, is_me, friend_id, share, debt_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, splitId, i, p.name, p.me, friendId, shares[i], debtId],
    );
  }
  return splitId;
}

const SELECT_SPLIT = `
  SELECT s.*, w.name AS wallet_name, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
  FROM splits s
  JOIN wallets w ON w.id = s.wallet_id
  JOIN categories c ON c.id = s.category_id
`;

/** People of some splits with what they still owe ("settled" once paid back). */
async function peopleOf(db: Db, splitIds: number[]) {
  if (splitIds.length === 0) return [];
  const { rows } = await db.query(
    `SELECT p.id, p.split_id, p.position, p.name, p.is_me, p.friend_id, p.share, p.debt_id,
            COALESCE((SELECT SUM(dp.amount) FROM debt_payments dp WHERE dp.debt_id = p.debt_id), 0) AS paid
     FROM split_people p WHERE p.split_id = ANY($1) ORDER BY p.split_id, p.position`,
    [splitIds],
  );
  return rows.map((r) => {
    const owed = r.is_me || r.debt_id === null ? 0 : Math.max(0, Math.round((r.share - r.paid) * 100) / 100);
    return { ...r, remaining: owed, status: r.is_me ? "me" : r.debt_id === null ? "removed" : owed === 0 ? "settled" : "owes" };
  });
}

function summarise(split: any, people: any[]) {
  const others = people.filter((p) => !p.is_me);
  const owed = Math.round(others.reduce((s, p) => s + p.remaining, 0) * 100) / 100;
  return {
    ...split,
    people,
    my_share: people.find((p) => p.is_me)?.share ?? 0,
    owed_to_me: owed,
    settled: others.every((p) => p.status !== "owes"),
  };
}

export async function fetchSplit(db: Db, userId: number, id: number) {
  const { rows } = await db.query(`${SELECT_SPLIT} WHERE s.id = $1 AND s.user_id = $2`, [id, userId]);
  if (rows.length === 0) throw new HttpError(404, "Split not found");
  return summarise(rows[0], await peopleOf(db, [id]));
}

export async function listSplits(db: Db, userId: number, limit: number) {
  const { rows } = await db.query(`${SELECT_SPLIT} WHERE s.user_id = $1 ORDER BY s.split_date DESC, s.id DESC LIMIT $2`, [userId, limit]);
  const people = await peopleOf(db, rows.map((r) => r.id));
  return rows.map((s) => summarise(s, people.filter((p) => p.split_id === s.id)));
}

/**
 * Deletes a split and undoes it: the user's expense, every friend's debt and any repayments already
 * recorded. Returns receipt files attached to the user's expense, to remove after the commit.
 */
export async function deleteSplit(client: PoolClient, userId: number, id: number): Promise<string[]> {
  const { rows } = await client.query("SELECT * FROM splits WHERE id = $1 AND user_id = $2 FOR UPDATE", [id, userId]);
  const split = rows[0];
  if (!split) throw new HttpError(404, "Split not found");
  const people = await client.query("SELECT debt_id FROM split_people WHERE split_id = $1 AND debt_id IS NOT NULL", [id]);
  for (const p of people.rows) await deleteDebt(client, userId, p.debt_id);
  let files: string[] = [];
  if (split.transaction_id) {
    await lockWallets(client, userId, [split.wallet_id]);
    files = (await client.query("SELECT stored_name FROM attachments WHERE transaction_id = $1", [split.transaction_id])).rows.map((r) => r.stored_name);
    await client.query("DELETE FROM splits WHERE id = $1", [id]); // before its transaction (FK)
    await deleteTransactionRow(client, split.transaction_id);
  } else {
    await client.query("DELETE FROM splits WHERE id = $1", [id]);
  }
  return files;
}
