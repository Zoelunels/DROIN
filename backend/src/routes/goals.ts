import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { pool, withTransaction, type Db } from "../db";
import { HttpError, readJson } from "../errors";
import { todayIn } from "../time";
import {
  optionalColor,
  optionalDate,
  optionalIcon,
  optionalString,
  parseId,
  queryFlag,
  requireAmount,
  requireDate,
  requireEnum,
  requireString,
} from "../validate";

// Savings goals ("Laptop Rp 15jt"). Contributions earmark money towards a goal; they do not move
// money between wallets or change balances.
export const goalsRouter = new Hono<AppEnv>();

const SELECT_GOAL = `
  SELECT g.*, COALESCE((SELECT SUM(gc.amount) FROM goal_contributions gc WHERE gc.goal_id = g.id), 0) AS saved_amount
  FROM goals g
`;

// Adds progress numbers the app needs to draw a goal card.
export function withProgress(goal: any, today: string) {
  const remaining = Math.max(0, Math.round((goal.target_amount - goal.saved_amount) * 100) / 100);
  const progress = Math.min(100, Math.round((goal.saved_amount / goal.target_amount) * 10000) / 100);
  let monthsLeft: number | null = null;
  let monthlyNeeded: number | null = null;
  if (goal.target_date && remaining > 0) {
    const [ty, tm] = goal.target_date.split("-").map(Number) as [number, number];
    const [cy, cm] = today.split("-").map(Number) as [number, number];
    // Counting the current month: due this month = 1 month left.
    monthsLeft = Math.max(1, (ty - cy) * 12 + (tm - cm) + 1);
    monthlyNeeded = Math.ceil((remaining / monthsLeft) * 100) / 100;
  }
  return {
    ...goal,
    remaining,
    progress,
    completed: remaining === 0,
    overdue: Boolean(goal.target_date && goal.target_date < today && remaining > 0),
    months_left: monthsLeft,
    monthly_needed: monthlyNeeded,
  };
}

async function fetchGoal(db: Db, userId: number, timezone: string, id: number) {
  const { rows } = await db.query(`${SELECT_GOAL} WHERE g.id = $1 AND g.user_id = $2`, [id, userId]);
  if (rows.length === 0) throw new HttpError(404, "Goal not found");
  return withProgress(rows[0], todayIn(timezone));
}

function parseInput(body: any) {
  return {
    name: requireString(body?.name, "name"),
    targetAmount: requireAmount(body?.target_amount, "target_amount"),
    targetDate: optionalDate(body?.target_date, "target_date"),
    icon: optionalIcon(body?.icon),
    color: optionalColor(body?.color),
  };
}

// GET /goals?include_archived=true
goalsRouter.get("/", async (c) => {
  const user = c.get("user");
  const archived = queryFlag(c.req.query("include_archived")) ? "" : "AND g.archived_at IS NULL";
  const { rows } = await pool.query(`${SELECT_GOAL} WHERE g.user_id = $1 ${archived} ORDER BY g.target_date NULLS LAST, g.id`, [
    user.id,
  ]);
  const today = todayIn(user.timezone);
  return c.json(rows.map((g) => withProgress(g, today)));
});

goalsRouter.get("/:id", async (c) => {
  const user = c.get("user");
  return c.json(await fetchGoal(pool, user.id, user.timezone, parseId(c.req.param("id"))));
});

// POST /goals { name, target_amount, target_date?, icon?, color?, initial_amount? }
goalsRouter.post("/", async (c) => {
  const user = c.get("user");
  const body = await readJson(c);
  const input = parseInput(body);
  const initial = body?.initial_amount === undefined || body.initial_amount === 0 ? 0 : requireAmount(body.initial_amount, "initial_amount");

  const goal = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO goals (user_id, name, target_amount, target_date, icon, color) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [user.id, input.name, input.targetAmount, input.targetDate, input.icon, input.color],
    );
    if (initial > 0) {
      await client.query(
        `INSERT INTO goal_contributions (user_id, goal_id, amount, contribution_date, note) VALUES ($1, $2, $3, $4, 'Starting amount')`,
        [user.id, rows[0].id, initial, todayIn(user.timezone)],
      );
    }
    return fetchGoal(client, user.id, user.timezone, rows[0].id);
  });
  return c.json(goal, 201);
});

goalsRouter.put("/:id", async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const input = parseInput(await readJson(c));
  const { rowCount } = await pool.query(
    `UPDATE goals SET name = $1, target_amount = $2, target_date = $3, icon = $4, color = $5
     WHERE id = $6 AND user_id = $7`,
    [input.name, input.targetAmount, input.targetDate, input.icon, input.color, id, user.id],
  );
  if (rowCount === 0) throw new HttpError(404, "Goal not found");
  return c.json(await fetchGoal(pool, user.id, user.timezone, id));
});

goalsRouter.post("/:id/archive", async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const { rowCount } = await pool.query(
    "UPDATE goals SET archived_at = COALESCE(archived_at, now()) WHERE id = $1 AND user_id = $2",
    [id, user.id],
  );
  if (rowCount === 0) throw new HttpError(404, "Goal not found");
  return c.json(await fetchGoal(pool, user.id, user.timezone, id));
});

goalsRouter.post("/:id/unarchive", async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const { rowCount } = await pool.query("UPDATE goals SET archived_at = NULL WHERE id = $1 AND user_id = $2", [id, user.id]);
  if (rowCount === 0) throw new HttpError(404, "Goal not found");
  return c.json(await fetchGoal(pool, user.id, user.timezone, id));
});

goalsRouter.delete("/:id", async (c) => {
  const { rowCount } = await pool.query("DELETE FROM goals WHERE id = $1 AND user_id = $2", [
    parseId(c.req.param("id")),
    c.get("user").id,
  ]);
  if (rowCount === 0) throw new HttpError(404, "Goal not found");
  return c.body(null, 204);
});

// ---------- contributions ----------

goalsRouter.get("/:id/contributions", async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  await fetchGoal(pool, user.id, user.timezone, id);
  const { rows } = await pool.query(
    "SELECT * FROM goal_contributions WHERE goal_id = $1 ORDER BY contribution_date DESC, id DESC",
    [id],
  );
  return c.json(rows);
});

// POST /goals/:id/contributions { amount, type: "deposit" | "withdraw", contribution_date?, note? }
// Returns the updated goal. A withdrawal cannot take out more than was saved.
goalsRouter.post("/:id/contributions", async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const body = await readJson(c);
  const amount = requireAmount(body?.amount);
  const kind = body?.type === undefined ? "deposit" : requireEnum(body.type, "type", ["deposit", "withdraw"] as const);
  const date = body?.contribution_date === undefined ? todayIn(user.timezone) : requireDate(body.contribution_date, "contribution_date");
  const note = optionalString(body?.note, "note");

  const goal = await withTransaction(async (client) => {
    const { rows } = await client.query("SELECT id FROM goals WHERE id = $1 AND user_id = $2 FOR UPDATE", [id, user.id]);
    if (rows.length === 0) throw new HttpError(404, "Goal not found");
    const current = await fetchGoal(client, user.id, user.timezone, id);
    if (kind === "withdraw" && amount > current.saved_amount) {
      throw new HttpError(400, "You cannot withdraw more than has been saved for this goal");
    }
    await client.query(
      `INSERT INTO goal_contributions (user_id, goal_id, amount, contribution_date, note) VALUES ($1, $2, $3, $4, $5)`,
      [user.id, id, kind === "withdraw" ? -amount : amount, date, note],
    );
    await client.query("UPDATE goals SET updated_at = now() WHERE id = $1", [id]);
    return fetchGoal(client, user.id, user.timezone, id);
  });
  return c.json(goal, 201);
});

goalsRouter.delete("/:id/contributions/:contributionId", async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const goal = await withTransaction(async (client) => {
    const { rows } = await client.query("SELECT id FROM goals WHERE id = $1 AND user_id = $2 FOR UPDATE", [id, user.id]);
    if (rows.length === 0) throw new HttpError(404, "Goal not found");
    const { rowCount } = await client.query("DELETE FROM goal_contributions WHERE id = $1 AND goal_id = $2", [
      parseId(c.req.param("contributionId"), "contributionId"),
      id,
    ]);
    if (rowCount === 0) throw new HttpError(404, "Contribution not found");
    const after = await fetchGoal(client, user.id, user.timezone, id);
    // Deleting an old deposit must not leave the goal below zero (because of later withdrawals).
    if (after.saved_amount < 0) throw new HttpError(409, "Removing this deposit would make the saved amount negative");
    await client.query("UPDATE goals SET updated_at = now() WHERE id = $1", [id]);
    return after;
  });
  return c.json(goal);
});
