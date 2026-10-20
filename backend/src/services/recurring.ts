import type { PoolClient } from "pg";
import { pool, withTransaction } from "../db";
import { HttpError } from "../errors";
import { addDays, addMonths, todayIn } from "../time";
import { createManualTransaction } from "./transactions";

export type Frequency = "daily" | "weekly" | "monthly" | "yearly";
export const FREQUENCIES: readonly Frequency[] = ["daily", "weekly", "monthly", "yearly"];

// Safety cap for catching up a rule that was idle for a long time (e.g. a daily rule after a year).
const MAX_CATCH_UP = 400;

// The n-th occurrence (0-based), always computed from start_date so month-end dates don't drift:
// monthly from Jan 31 → Feb 28 → Mar 31 → Apr 30 …
export function occurrenceDate(startDate: string, frequency: Frequency, interval: number, n: number): string {
  switch (frequency) {
    case "daily":
      return addDays(startDate, n * interval);
    case "weekly":
      return addDays(startDate, n * interval * 7);
    case "monthly":
      return addMonths(startDate, n * interval);
    case "yearly":
      return addMonths(startDate, n * interval * 12);
  }
}

// next_date for a rule after `done` occurrences, or null when it is past end_date.
export function nextDateAfter(
  rule: { start_date: string; frequency: Frequency; interval_count: number; end_date: string | null },
  done: number,
): string | null {
  const next = occurrenceDate(rule.start_date, rule.frequency, rule.interval_count, done);
  return rule.end_date !== null && next > rule.end_date ? null : next;
}

// How many occurrences fall strictly before `date` (used when a schedule is edited, so past
// occurrences of the new schedule are not created retroactively).
export function occurrencesBefore(
  rule: { start_date: string; frequency: Frequency; interval_count: number },
  date: string,
): number {
  let n = 0;
  while (n < 100_000 && occurrenceDate(rule.start_date, rule.frequency, rule.interval_count, n) < date) n++;
  return n;
}

export async function lockRule(client: PoolClient, userId: number, id: number) {
  const { rows } = await client.query("SELECT * FROM recurring_rules WHERE id = $1 AND user_id = $2 FOR UPDATE", [
    id,
    userId,
  ]);
  if (rows.length === 0) throw new HttpError(404, "Recurring rule not found");
  return rows[0];
}

// Move a rule past its current occurrence (after creating or skipping it).
export async function advanceRule(client: PoolClient, rule: any): Promise<void> {
  const done = rule.occurrences_done + 1;
  await client.query("UPDATE recurring_rules SET occurrences_done = $1, next_date = $2 WHERE id = $3", [
    done,
    nextDateAfter(rule, done),
    rule.id,
  ]);
}

// Create the transaction for a rule's current occurrence and advance the rule.
// Overrides let the user confirm with a different amount/date ("rent was 50k more this month").
export async function createOccurrence(
  client: PoolClient,
  rule: any,
  overrides: { amount?: number; transactionDate?: string; note?: string | null } = {},
): Promise<number> {
  const id = await createManualTransaction(
    client,
    rule.user_id,
    {
      walletId: rule.wallet_id,
      categoryId: rule.category_id,
      type: rule.type,
      amount: overrides.amount ?? rule.amount,
      note: overrides.note !== undefined ? overrides.note : rule.note,
      transactionDate: overrides.transactionDate ?? rule.next_date,
    },
    // A rule keeps running even if its wallet/category was archived later.
    { recurringRuleId: rule.id, allowArchived: true },
  );
  await advanceRule(client, rule);
  return id;
}

// Create every due occurrence of one auto-create rule, up to "today" in the user's timezone.
// Each occurrence is its own DB transaction, so one bad occurrence does not undo the others.
export async function catchUpRule(ruleId: number, userId: number, timezone: string): Promise<number> {
  const today = todayIn(timezone);
  let created = 0;
  while (created < MAX_CATCH_UP) {
    const done = await withTransaction(async (client) => {
      const rule = await lockRule(client, userId, ruleId);
      if (rule.paused || !rule.auto_create || rule.next_date === null || rule.next_date > today) return true;
      await createOccurrence(client, rule);
      return false;
    });
    if (done) break;
    created++;
  }
  return created;
}

// Run every due auto-create rule — for one user (POST /recurring/run) or for everyone (scheduler).
export async function processDueRules(userId?: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT r.id, r.user_id, u.timezone
     FROM recurring_rules r JOIN users u ON u.id = r.user_id
     WHERE NOT r.paused AND r.auto_create AND r.next_date IS NOT NULL
       AND r.next_date <= (now() AT TIME ZONE u.timezone)::date
       ${userId === undefined ? "" : "AND r.user_id = $1"}`,
    userId === undefined ? [] : [userId],
  );
  let created = 0;
  for (const r of rows) {
    try {
      created += await catchUpRule(r.id, r.user_id, r.timezone);
    } catch (err) {
      // One broken rule (e.g. its wallet was deleted) must not stop the others.
      console.error(`Recurring rule ${r.id} failed:`, err);
    }
  }
  return created;
}
