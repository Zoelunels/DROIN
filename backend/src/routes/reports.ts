import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { pool } from "../db";
import { HttpError } from "../errors";
import { createFilters } from "../query";
import { monthIn, monthRange } from "../time";
import { parseId, requireDate, requireMonth, requireType } from "../validate";

export const reportsRouter = new Hono<AppEnv>();

// IMPORTANT: transactions without a category (transfer legs, debt movements) are not counted
// as income/expense — that is just money moving between your own wallets or borrowed money.
export const COUNTED = "t.category_id IS NOT NULL";

// GET /reports/categories?from=&to=&type=&wallet_id=
// Total per category in the period, plus its share of the type's total (for a pie chart).
reportsRouter.get("/categories", async (c) => {
  const q = c.req.query();
  const filters = createFilters();
  filters.add("t.user_id = ?", c.get("user").id);
  filters.addRaw(COUNTED);
  if (q.from !== undefined) filters.add("t.transaction_date >= ?", requireDate(q.from, "from"));
  if (q.to !== undefined) filters.add("t.transaction_date <= ?", requireDate(q.to, "to"));
  if (q.wallet_id !== undefined) filters.add("t.wallet_id = ?", parseId(q.wallet_id, "wallet_id"));
  if (q.type !== undefined) filters.add("t.type = ?", requireType(q.type));

  const categories = await pool.query(
    `SELECT c.id AS category_id,
            c.name AS category_name,
            c.icon, c.color,
            c.type,
            SUM(t.amount) AS total,
            COUNT(*)::int AS count,
            -- Window function: total per type (income/expense) without collapsing the rows.
            ROUND(SUM(t.amount) * 100 / SUM(SUM(t.amount)) OVER (PARTITION BY c.type), 2) AS percentage
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     ${filters.where()}
     GROUP BY c.id
     ORDER BY c.type, total DESC`,
    filters.params,
  );

  const totals = await pool.query(
    `SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0) AS income_total,
            COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS expense_total,
            COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END), 0) AS net
     FROM transactions t
     ${filters.where()}`,
    filters.params,
  );

  return c.json({
    from: q.from ?? null,
    to: q.to ?? null,
    ...totals.rows[0],
    categories: categories.rows,
  });
});

// GET /reports/tags?from=&to= — spending/income per tag (a transaction with 2 tags counts in both).
reportsRouter.get("/tags", async (c) => {
  const q = c.req.query();
  const filters = createFilters();
  filters.add("t.user_id = ?", c.get("user").id);
  filters.addRaw(COUNTED);
  if (q.from !== undefined) filters.add("t.transaction_date >= ?", requireDate(q.from, "from"));
  if (q.to !== undefined) filters.add("t.transaction_date <= ?", requireDate(q.to, "to"));

  const { rows } = await pool.query(
    `SELECT g.id AS tag_id, g.name AS tag_name, g.color,
            COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0) AS income,
            COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS expense,
            COUNT(*)::int AS count
     FROM transactions t
     JOIN transaction_tags tt ON tt.transaction_id = t.id
     JOIN tags g ON g.id = tt.tag_id
     ${filters.where()}
     GROUP BY g.id
     ORDER BY expense DESC, lower(g.name)`,
    filters.params,
  );
  return c.json(rows);
});

// GET /reports/balances — every active wallet's balance + the overall total.
reportsRouter.get("/balances", async (c) => {
  const userId = c.get("user").id;
  const wallets = await pool.query(
    `SELECT id, name, wallet_type, icon, color, balance FROM wallets
     WHERE user_id = $1 AND archived_at IS NULL ORDER BY id`,
    [userId],
  );
  // The total includes archived wallets too: their money still exists.
  const total = await pool.query("SELECT COALESCE(SUM(balance), 0) AS total FROM wallets WHERE user_id = $1", [userId]);
  return c.json({ total: total.rows[0].total, wallets: wallets.rows });
});

// GET /reports/monthly?from=YYYY-MM&to=YYYY-MM&wallet_id=
// Income/expense/net trend per month. Default: the last 12 months (including this one),
// where "this month" is taken in the user's timezone.
// Months without transactions still appear with 0 (built with generate_series).
reportsRouter.get("/monthly", async (c) => {
  const q = c.req.query();
  const user = c.get("user");
  const from = q.from === undefined ? monthIn(user.timezone, 11) : requireMonth(q.from, "from");
  const to = q.to === undefined ? monthIn(user.timezone, 0) : requireMonth(q.to, "to");
  if (from > to) throw new HttpError(400, "from cannot be after to");

  const params: unknown[] = [`${from}-01`, `${to}-01`, user.id];
  let walletCondition = "";
  if (q.wallet_id !== undefined) {
    params.push(parseId(q.wallet_id, "wallet_id"));
    walletCondition = `AND t.wallet_id = $${params.length}`;
  }

  // The transaction filter sits in the JOIN condition (not WHERE), so months without
  // transactions are not filtered out and still show up with 0.
  const { rows } = await pool.query(
    `WITH months AS (
       SELECT generate_series($1::date, $2::date, interval '1 month')::date AS month_start
     )
     SELECT to_char(m.month_start, 'YYYY-MM') AS month,
            COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0) AS income,
            COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS expense,
            COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END), 0) AS net
     FROM months m
     LEFT JOIN transactions t
       ON t.transaction_date >= m.month_start
      AND t.transaction_date < m.month_start + interval '1 month'
      AND t.user_id = $3
      AND ${COUNTED}
      ${walletCondition}
     GROUP BY m.month_start
     ORDER BY m.month_start`,
    params,
  );
  return c.json(rows);
});

// GET /reports/daily?month=YYYY-MM&wallet_id= — one row per day of the month (for a calendar
// heatmap or a "Today" list). Default: the current month in the user's timezone.
reportsRouter.get("/daily", async (c) => {
  const q = c.req.query();
  const user = c.get("user");
  const month = q.month === undefined ? monthIn(user.timezone) : requireMonth(q.month, "month");
  const { start, end } = monthRange(month);

  const params: unknown[] = [start, end, user.id];
  let walletCondition = "";
  if (q.wallet_id !== undefined) {
    params.push(parseId(q.wallet_id, "wallet_id"));
    walletCondition = `AND t.wallet_id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `WITH days AS (
       SELECT generate_series($1::date, $2::date - 1, interval '1 day')::date AS day
     )
     SELECT d.day AS date,
            COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0) AS income,
            COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS expense,
            COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END), 0) AS net,
            COUNT(t.id)::int AS count
     FROM days d
     LEFT JOIN transactions t
       ON t.transaction_date = d.day
      AND t.user_id = $3
      AND ${COUNTED}
      ${walletCondition}
     GROUP BY d.day
     ORDER BY d.day`,
    params,
  );
  return c.json({ month, days: rows });
});
