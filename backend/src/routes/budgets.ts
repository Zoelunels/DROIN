import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { pool, type Db } from "../db";
import { HttpError, readJson } from "../errors";
import { daysBetween, daysInMonth, monthIn, monthRange, todayIn } from "../time";
import { optionalId, parseId, requireAmount, requireMonth } from "../validate";

// Monthly spending limits. A budget without category_id limits total spending.
export const budgetsRouter = new Hono<AppEnv>();

const SELECT_BUDGET = `
  SELECT b.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
  FROM budgets b LEFT JOIN categories c ON c.id = b.category_id
`;

async function checkExpenseCategory(userId: number, categoryId: number | null): Promise<void> {
  if (categoryId === null) return;
  const { rows } = await pool.query("SELECT type FROM categories WHERE id = $1 AND user_id = $2", [categoryId, userId]);
  if (rows.length === 0) throw new HttpError(400, "category_id not found");
  if (rows[0].type !== "expense") throw new HttpError(400, "A budget can only be set on an expense category");
}

export type BudgetStatus = "ok" | "warning" | "over";

// Every budget with what was spent in `month`, what is left, and how much can still be spent
// per day for the rest of the month.
export async function budgetStatus(db: Db, userId: number, timezone: string, month: string) {
  const { start, end } = monthRange(month);
  const { rows } = await db.query(
    `SELECT b.id, b.category_id, b.amount,
            c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
            COALESCE((
              SELECT SUM(t.amount) FROM transactions t
              WHERE t.user_id = b.user_id AND t.type = 'expense' AND t.category_id IS NOT NULL
                AND (b.category_id IS NULL OR t.category_id = b.category_id)
                AND t.transaction_date >= $2 AND t.transaction_date < $3
            ), 0) AS spent
     FROM budgets b LEFT JOIN categories c ON c.id = b.category_id
     WHERE b.user_id = $1
     ORDER BY b.category_id NULLS FIRST, c.name`,
    [userId, start, end],
  );

  const today = todayIn(timezone);
  const isCurrentMonth = today.slice(0, 7) === month;
  // Days left including today; past months have none, future months have all of them.
  const daysLeft = isCurrentMonth ? daysBetween(today, end) : month > today.slice(0, 7) ? daysInMonth(month) : 0;

  return rows.map((b) => {
    const remaining = Math.round((b.amount - b.spent) * 100) / 100;
    const percentage = Math.round((b.spent / b.amount) * 10000) / 100;
    const status: BudgetStatus = b.spent > b.amount ? "over" : percentage >= 80 ? "warning" : "ok";
    return {
      ...b,
      remaining,
      percentage,
      status,
      days_left: daysLeft,
      daily_allowance: daysLeft > 0 && remaining > 0 ? Math.floor((remaining / daysLeft) * 100) / 100 : 0,
    };
  });
}

budgetsRouter.get("/", async (c) => {
  const { rows } = await pool.query(`${SELECT_BUDGET} WHERE b.user_id = $1 ORDER BY b.category_id NULLS FIRST, c.name`, [
    c.get("user").id,
  ]);
  return c.json(rows);
});

// GET /budgets/status?month=YYYY-MM (default: this month in the user's timezone)
budgetsRouter.get("/status", async (c) => {
  const user = c.get("user");
  const monthQuery = c.req.query("month");
  const month = monthQuery === undefined ? monthIn(user.timezone) : requireMonth(monthQuery, "month");
  return c.json({ month, budgets: await budgetStatus(pool, user.id, user.timezone, month) });
});

budgetsRouter.get("/:id", async (c) => {
  const { rows } = await pool.query(`${SELECT_BUDGET} WHERE b.id = $1 AND b.user_id = $2`, [
    parseId(c.req.param("id")),
    c.get("user").id,
  ]);
  if (rows.length === 0) throw new HttpError(404, "Budget not found");
  return c.json(rows[0]);
});

// POST /budgets { category_id (omit/null = overall budget), amount }
budgetsRouter.post("/", async (c) => {
  const userId = c.get("user").id;
  const body = await readJson(c);
  const categoryId = optionalId(body?.category_id, "category_id");
  const amount = requireAmount(body?.amount);
  await checkExpenseCategory(userId, categoryId);

  const existing = await pool.query(
    "SELECT 1 FROM budgets WHERE user_id = $1 AND category_id IS NOT DISTINCT FROM $2",
    [userId, categoryId],
  );
  if (existing.rows.length > 0) {
    throw new HttpError(409, categoryId === null ? "An overall budget already exists" : "This category already has a budget");
  }
  const { rows } = await pool.query("INSERT INTO budgets (user_id, category_id, amount) VALUES ($1, $2, $3) RETURNING id", [
    userId,
    categoryId,
    amount,
  ]);
  const created = await pool.query(`${SELECT_BUDGET} WHERE b.id = $1`, [rows[0].id]);
  return c.json(created.rows[0], 201);
});

// Only the amount can change; to budget another category, create a new budget.
budgetsRouter.put("/:id", async (c) => {
  const body = await readJson(c);
  const { rows } = await pool.query("UPDATE budgets SET amount = $1 WHERE id = $2 AND user_id = $3 RETURNING id", [
    requireAmount(body?.amount),
    parseId(c.req.param("id")),
    c.get("user").id,
  ]);
  if (rows.length === 0) throw new HttpError(404, "Budget not found");
  const updated = await pool.query(`${SELECT_BUDGET} WHERE b.id = $1`, [rows[0].id]);
  return c.json(updated.rows[0]);
});

budgetsRouter.delete("/:id", async (c) => {
  const { rowCount } = await pool.query("DELETE FROM budgets WHERE id = $1 AND user_id = $2", [
    parseId(c.req.param("id")),
    c.get("user").id,
  ]);
  if (rowCount === 0) throw new HttpError(404, "Budget not found");
  return c.body(null, 204);
});
