import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { pool, withTransaction } from "../db";
import { HttpError, readJson } from "../errors";
import { checkCategory } from "../services/categories";
import {
  FREQUENCIES,
  advanceRule,
  catchUpRule,
  createOccurrence,
  lockRule,
  nextDateAfter,
  occurrencesBefore,
  processDueRules,
  type Frequency,
} from "../services/recurring";
import { fetchTransaction } from "../services/transactions";
import { addDays, todayIn } from "../time";
import {
  optionalBoolean,
  optionalDate,
  optionalString,
  parseId,
  requireAmount,
  requireDate,
  requireEnum,
  requireType,
  type TransactionType,
} from "../validate";

// Repeating income/expense: salary, rent, subscriptions.
//   auto_create = true  → the server creates the transaction on its date (checked every few minutes)
//   auto_create = false → it shows up in GET /recurring/due and the user confirms or skips it
export const recurringRouter = new Hono<AppEnv>();

const SELECT_RULE = `
  SELECT r.*, w.name AS wallet_name, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
  FROM recurring_rules r
  JOIN wallets w ON w.id = r.wallet_id
  JOIN categories c ON c.id = r.category_id
`;

interface RuleInput {
  walletId: number;
  categoryId: number;
  type: TransactionType;
  amount: number;
  note: string | null;
  frequency: Frequency;
  intervalCount: number;
  startDate: string;
  endDate: string | null;
  autoCreate: boolean;
}

function parseInput(body: any): RuleInput {
  const intervalCount = body?.interval_count === undefined ? 1 : Number(body.interval_count);
  if (!Number.isInteger(intervalCount) || intervalCount < 1 || intervalCount > 365) {
    throw new HttpError(400, "interval_count must be a whole number from 1 to 365");
  }
  const input: RuleInput = {
    walletId: parseId(body?.wallet_id, "wallet_id"),
    categoryId: parseId(body?.category_id, "category_id"),
    type: requireType(body?.type),
    amount: requireAmount(body?.amount),
    note: optionalString(body?.note, "note"),
    frequency: requireEnum(body?.frequency, "frequency", FREQUENCIES),
    intervalCount,
    startDate: requireDate(body?.start_date, "start_date"),
    endDate: optionalDate(body?.end_date, "end_date"),
    autoCreate: optionalBoolean(body?.auto_create, "auto_create", true),
  };
  if (input.endDate !== null && input.endDate < input.startDate) {
    throw new HttpError(400, "end_date cannot be before start_date");
  }
  return input;
}

async function checkRefs(userId: number, input: RuleInput): Promise<void> {
  const { rows } = await pool.query("SELECT 1 FROM wallets WHERE id = $1 AND user_id = $2", [input.walletId, userId]);
  if (rows.length === 0) throw new HttpError(400, "wallet_id not found");
  await checkCategory(pool, userId, input.categoryId, input.type);
}

async function fetchRule(userId: number, id: number) {
  const { rows } = await pool.query(`${SELECT_RULE} WHERE r.id = $1 AND r.user_id = $2`, [id, userId]);
  if (rows.length === 0) throw new HttpError(404, "Recurring rule not found");
  return rows[0];
}

recurringRouter.get("/", async (c) => {
  const { rows } = await pool.query(`${SELECT_RULE} WHERE r.user_id = $1 ORDER BY r.next_date NULLS LAST, r.id`, [
    c.get("user").id,
  ]);
  return c.json(rows);
});

// GET /recurring/due?days=7
//   due       occurrences waiting for confirmation (auto_create = false, date ≤ today)
//   upcoming  every active rule whose next occurrence is within the next `days` days
recurringRouter.get("/due", async (c) => {
  const user = c.get("user");
  const days = c.req.query("days") === undefined ? 7 : Number(c.req.query("days"));
  if (!Number.isInteger(days) || days < 0 || days > 365) throw new HttpError(400, "days must be from 0 to 365");
  const today = todayIn(user.timezone);

  const { rows } = await pool.query(
    `${SELECT_RULE}
     WHERE r.user_id = $1 AND NOT r.paused AND r.next_date IS NOT NULL AND r.next_date <= $2
     ORDER BY r.next_date, r.id`,
    [user.id, addDays(today, days)],
  );
  return c.json({
    today,
    due: rows.filter((r) => !r.auto_create && r.next_date <= today),
    upcoming: rows.filter((r) => r.next_date > today),
  });
});

recurringRouter.get("/:id", async (c) => {
  return c.json(await fetchRule(c.get("user").id, parseId(c.req.param("id"))));
});

// A start_date in the past is allowed: missed occurrences are created right away (auto_create)
// or show up as due.
recurringRouter.post("/", async (c) => {
  const user = c.get("user");
  const input = parseInput(await readJson(c));
  await checkRefs(user.id, input);

  const rule = { start_date: input.startDate, frequency: input.frequency, interval_count: input.intervalCount, end_date: input.endDate };
  const { rows } = await pool.query(
    `INSERT INTO recurring_rules
       (user_id, wallet_id, category_id, type, amount, note, frequency, interval_count, start_date, end_date, next_date, auto_create)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      user.id, input.walletId, input.categoryId, input.type, input.amount, input.note, input.frequency,
      input.intervalCount, input.startDate, input.endDate, nextDateAfter(rule, 0), input.autoCreate,
    ],
  );
  if (input.autoCreate) await catchUpRule(rows[0].id, user.id, user.timezone);
  return c.json(await fetchRule(user.id, rows[0].id), 201);
});

// Changing the schedule (start/frequency/interval) restarts counting from today:
// occurrences of the new schedule that lie in the past are NOT created.
recurringRouter.put("/:id", async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const input = parseInput(await readJson(c));
  await checkRefs(user.id, input);

  await withTransaction(async (client) => {
    const old = await lockRule(client, user.id, id);
    const scheduleChanged =
      old.start_date !== input.startDate || old.frequency !== input.frequency || old.interval_count !== input.intervalCount;
    const rule = { start_date: input.startDate, frequency: input.frequency, interval_count: input.intervalCount, end_date: input.endDate };
    const done = scheduleChanged ? occurrencesBefore(rule, todayIn(user.timezone)) : old.occurrences_done;

    await client.query(
      `UPDATE recurring_rules
       SET wallet_id = $1, category_id = $2, type = $3, amount = $4, note = $5, frequency = $6,
           interval_count = $7, start_date = $8, end_date = $9, auto_create = $10,
           occurrences_done = $11, next_date = $12
       WHERE id = $13`,
      [
        input.walletId, input.categoryId, input.type, input.amount, input.note, input.frequency,
        input.intervalCount, input.startDate, input.endDate, input.autoCreate, done, nextDateAfter(rule, done), id,
      ],
    );
  });
  if (input.autoCreate) await catchUpRule(id, user.id, user.timezone);
  return c.json(await fetchRule(user.id, id));
});

recurringRouter.post("/:id/pause", async (c) => {
  const id = parseId(c.req.param("id"));
  const { rowCount } = await pool.query("UPDATE recurring_rules SET paused = true WHERE id = $1 AND user_id = $2", [
    id,
    c.get("user").id,
  ]);
  if (rowCount === 0) throw new HttpError(404, "Recurring rule not found");
  return c.json(await fetchRule(c.get("user").id, id));
});

// Resuming creates anything missed while paused (if auto_create). Use /skip first to avoid that.
recurringRouter.post("/:id/resume", async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const { rowCount } = await pool.query("UPDATE recurring_rules SET paused = false WHERE id = $1 AND user_id = $2", [
    id,
    user.id,
  ]);
  if (rowCount === 0) throw new HttpError(404, "Recurring rule not found");
  await catchUpRule(id, user.id, user.timezone);
  return c.json(await fetchRule(user.id, id));
});

// POST /recurring/:id/confirm { amount?, transaction_date?, note? }
// Creates the transaction for the rule's next occurrence (may be done early) and moves the rule on.
recurringRouter.post("/:id/confirm", async (c) => {
  const userId = c.get("user").id;
  const id = parseId(c.req.param("id"));
  const body = await readJson(c).catch(() => ({}));
  const overrides = {
    amount: body?.amount === undefined ? undefined : requireAmount(body.amount),
    transactionDate: body?.transaction_date === undefined ? undefined : requireDate(body.transaction_date, "transaction_date"),
    note: body?.note === undefined ? undefined : optionalString(body.note, "note"),
  };

  const transaction = await withTransaction(async (client) => {
    const rule = await lockRule(client, userId, id);
    if (rule.next_date === null) throw new HttpError(409, "This rule has no more occurrences");
    const txId = await createOccurrence(client, rule, overrides);
    return fetchTransaction(client, userId, txId);
  });
  return c.json({ transaction, rule: await fetchRule(userId, id) }, 201);
});

// Skip the next occurrence without creating a transaction.
recurringRouter.post("/:id/skip", async (c) => {
  const userId = c.get("user").id;
  const id = parseId(c.req.param("id"));
  await withTransaction(async (client) => {
    const rule = await lockRule(client, userId, id);
    if (rule.next_date === null) throw new HttpError(409, "This rule has no more occurrences");
    await advanceRule(client, rule);
  });
  return c.json(await fetchRule(userId, id));
});

// Create all due auto-create occurrences now (the scheduler also does this every few minutes).
recurringRouter.post("/run", async (c) => {
  return c.json({ created: await processDueRules(c.get("user").id) });
});

// Transactions already created by the rule are kept (their recurring_rule_id becomes NULL).
recurringRouter.delete("/:id", async (c) => {
  const { rowCount } = await pool.query("DELETE FROM recurring_rules WHERE id = $1 AND user_id = $2", [
    parseId(c.req.param("id")),
    c.get("user").id,
  ]);
  if (rowCount === 0) throw new HttpError(404, "Recurring rule not found");
  return c.body(null, 204);
});
