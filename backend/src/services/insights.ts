import { pool } from "../db";
import { budgetStatus } from "../routes/budgets";
import { withProgress } from "../routes/goals";
import { addDays, daysBetween, monthRange, shiftMonth, todayIn } from "../time";

// Small observations the app can show in the mascot's voice. Plain SQL, no AI.
// tone: positive (good news) | warning (needs attention) | neutral (just so you know)
export interface Insight {
  kind: string;
  tone: "positive" | "warning" | "neutral";
  title: string;
  message: string;
  data: Record<string, unknown>;
}

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const pct = (n: number) => `${Math.round(Math.abs(n))}%`;

// Expense total per category between two dates (inclusive start, exclusive end).
async function spendingByCategory(userId: number, start: string, end: string) {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, SUM(t.amount) AS total
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = $1 AND t.type = 'expense' AND t.transaction_date >= $2 AND t.transaction_date < $3
     GROUP BY c.id`,
    [userId, start, end],
  );
  return new Map<number, { name: string; total: number }>(rows.map((r) => [r.id, { name: r.name, total: r.total }]));
}

async function incomeExpense(userId: number, start: string, end: string) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) AS income,
            COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS expense
     FROM transactions
     WHERE user_id = $1 AND category_id IS NOT NULL AND transaction_date >= $2 AND transaction_date < $3`,
    [userId, start, end],
  );
  return rows[0] as { income: number; expense: number };
}

export async function buildInsights(userId: number, timezone: string, month: string): Promise<Insight[]> {
  const insights: Insight[] = [];
  const today = todayIn(timezone);
  const isCurrentMonth = today.slice(0, 7) === month;
  const { start, end } = monthRange(month);
  const previous = monthRange(shiftMonth(month, -1));

  // For the current month compare like with like: the 1st..today vs the 1st..same day last month.
  const dayOfMonth = isCurrentMonth ? Number(today.slice(8, 10)) : null;
  const periodEnd = dayOfMonth ? addDays(today, 1) : end;
  const prevPeriodEnd = dayOfMonth
    ? addDays(previous.start, Math.min(dayOfMonth, daysBetween(previous.start, previous.end)))
    : previous.end;

  // 1. Spending pace vs last month.
  const [now, before] = await Promise.all([
    incomeExpense(userId, start, periodEnd),
    incomeExpense(userId, previous.start, prevPeriodEnd),
  ]);
  if (before.expense > 0 && now.expense > 0) {
    const change = ((now.expense - before.expense) / before.expense) * 100;
    const when = isCurrentMonth ? "than this time last month" : "than the month before";
    if (change >= 20) {
      insights.push({
        kind: "spending_up", tone: "warning", title: "Spending is up",
        message: `You've spent ${pct(change)} more ${when}.`,
        data: { current: now.expense, previous: before.expense, change_percent: Math.round(change) },
      });
    } else if (change <= -10) {
      insights.push({
        kind: "spending_down", tone: "positive", title: "Nice and calm",
        message: `You've spent ${pct(change)} less ${when}. Keep it up.`,
        data: { current: now.expense, previous: before.expense, change_percent: Math.round(change) },
      });
    }
  }

  // 2. Biggest category, and categories that jumped compared to last month.
  const [cats, prevCats] = await Promise.all([
    spendingByCategory(userId, start, periodEnd),
    spendingByCategory(userId, previous.start, prevPeriodEnd),
  ]);
  const sorted = [...cats.entries()].sort((a, b) => b[1].total - a[1].total);
  const top = sorted[0];
  if (top && now.expense > 0) {
    const share = (top[1].total / now.expense) * 100;
    if (share >= 30) {
      insights.push({
        kind: "top_category", tone: "neutral", title: `${top[1].name} leads`,
        message: `${top[1].name} takes ${pct(share)} of your spending this month.`,
        data: { category_id: top[0], total: top[1].total, share_percent: Math.round(share) },
      });
    }
  }
  for (const [id, cat] of sorted) {
    const prev = prevCats.get(id)?.total ?? 0;
    // Only flag meaningful jumps: +50% and at least Rp 50.000 more.
    if (prev > 0 && cat.total >= prev * 1.5 && cat.total - prev >= 50_000) {
      insights.push({
        kind: "category_spike", tone: "warning", title: `${cat.name} jumped`,
        message: `${cat.name} is up ${pct(((cat.total - prev) / prev) * 100)} compared to last month.`,
        data: { category_id: id, current: cat.total, previous: prev },
      });
      if (insights.filter((i) => i.kind === "category_spike").length >= 2) break;
    }
  }

  // 3. Budgets close to or over their limit.
  for (const b of await budgetStatus(pool, userId, timezone, month)) {
    const name = b.category_name ?? "overall";
    if (b.status === "over") {
      insights.push({
        kind: "budget_over", tone: "warning", title: "Over budget",
        message: `You're ${rupiah(-b.remaining)} over your ${name} budget.`,
        data: { budget_id: b.id, spent: b.spent, amount: b.amount },
      });
    } else if (b.status === "warning") {
      insights.push({
        kind: "budget_warning", tone: "warning", title: "Budget almost used",
        message: `${Math.round(b.percentage)}% of your ${name} budget is gone${b.days_left > 0 ? ` with ${b.days_left} days to go` : ""}.`,
        data: { budget_id: b.id, spent: b.spent, amount: b.amount, days_left: b.days_left },
      });
    }
  }

  // 4. How much of the income was kept.
  if (now.income > 0) {
    const kept = ((now.income - now.expense) / now.income) * 100;
    insights.push(
      kept >= 0
        ? {
            kind: "savings_rate", tone: kept >= 20 ? "positive" : "neutral", title: "Still got some",
            message: `You kept ${pct(kept)} of your income this month.`,
            data: { income: now.income, expense: now.expense, kept_percent: Math.round(kept) },
          }
        : {
            kind: "savings_rate", tone: "warning", title: "Spending more than earning",
            message: `You've spent ${rupiah(now.expense - now.income)} more than you earned this month.`,
            data: { income: now.income, expense: now.expense, kept_percent: Math.round(kept) },
          },
    );
  }

  if (isCurrentMonth) {
    // 5. Nothing logged today.
    const todayCount = await pool.query(
      "SELECT count(*)::int AS n FROM transactions WHERE user_id = $1 AND transaction_date = $2 AND origin = 'manual'",
      [userId, today],
    );
    if (todayCount.rows[0].n === 0) {
      insights.push({
        kind: "empty_day", tone: "neutral", title: "Quiet day",
        message: "Nothing happened here today. Suspicious.",
        data: { date: today },
      });
    }

    // 6. Goals with a deadline in the next 30 days that are not done yet.
    const goals = await pool.query(
      `SELECT g.*, COALESCE((SELECT SUM(amount) FROM goal_contributions WHERE goal_id = g.id), 0) AS saved_amount
       FROM goals g WHERE g.user_id = $1 AND g.archived_at IS NULL AND g.target_date BETWEEN $2 AND $3`,
      [userId, today, addDays(today, 30)],
    );
    for (const g of goals.rows.map((row) => withProgress(row, today)).filter((g) => !g.completed)) {
      const days = daysBetween(today, g.target_date);
      insights.push({
        kind: "goal_due_soon", tone: "neutral", title: `${g.name} is close`,
        message: `${g.name} is due ${days === 0 ? "today" : `in ${days} days`} — ${rupiah(g.remaining)} to go.`,
        data: { goal_id: g.id, remaining: g.remaining, days_left: days },
      });
    }

    // 7. Debts due within a week, or already overdue.
    const debts = await pool.query(
      `SELECT d.id, d.direction, d.counterparty, d.due_date,
              d.amount - COALESCE((SELECT SUM(amount) FROM debt_payments WHERE debt_id = d.id), 0) AS remaining
       FROM debts d WHERE d.user_id = $1 AND d.settled_at IS NULL AND d.due_date <= $2
       ORDER BY d.due_date`,
      [userId, addDays(today, 7)],
    );
    for (const d of debts.rows) {
      const overdue = d.due_date < today;
      const who = d.direction === "payable" ? `You owe ${d.counterparty}` : `${d.counterparty} owes you`;
      insights.push({
        kind: overdue ? "debt_overdue" : "debt_due_soon", tone: "warning",
        title: overdue ? "Overdue debt" : "Debt due soon",
        message: `${who} ${rupiah(d.remaining)}, ${overdue ? "it was due" : "due"} ${d.due_date}.`,
        data: { debt_id: d.id, remaining: d.remaining, due_date: d.due_date },
      });
    }

    // 8. Recurring items waiting for confirmation.
    const due = await pool.query(
      `SELECT count(*)::int AS n FROM recurring_rules
       WHERE user_id = $1 AND NOT paused AND NOT auto_create AND next_date <= $2`,
      [userId, today],
    );
    if (due.rows[0].n > 0) {
      insights.push({
        kind: "recurring_due", tone: "neutral", title: "Waiting for you",
        message: `${due.rows[0].n} recurring ${due.rows[0].n === 1 ? "item needs" : "items need"} a quick confirm.`,
        data: { count: due.rows[0].n },
      });
    }
  }

  // Most important first: warnings, then the rest.
  const order = { warning: 0, positive: 1, neutral: 2 };
  return insights.sort((a, b) => order[a.tone] - order[b.tone]);
}
