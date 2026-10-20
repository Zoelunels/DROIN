import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { pool } from "../db";
import { createFilters } from "../query";
import { monthIn, monthRange } from "../time";
import { parseId, requireDate, requireMonth } from "../validate";
import { budgetStatus } from "./budgets";

export const exportRouter = new Hono<AppEnv>();

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Cells starting with = + - @ are run as formulas by Excel/Sheets; prefix them so they stay text.
  if (/^[=+\-@\t\r]/.test(text) && typeof value === "string") text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// GET /export/transactions.csv?from=&to=&wallet_id=
// Opens directly in Excel / Google Sheets (UTF-8 with BOM so Excel shows non-ASCII text correctly).
exportRouter.get("/transactions.csv", async (c) => {
  const q = c.req.query();
  const filters = createFilters();
  filters.add("t.user_id = ?", c.get("user").id);
  if (q.from !== undefined) filters.add("t.transaction_date >= ?", requireDate(q.from, "from"));
  if (q.to !== undefined) filters.add("t.transaction_date <= ?", requireDate(q.to, "to"));
  if (q.wallet_id !== undefined) filters.add("t.wallet_id = ?", parseId(q.wallet_id, "wallet_id"));

  const { rows } = await pool.query(
    `SELECT t.transaction_date, t.type, t.origin, c.name AS category, w.name AS wallet, t.amount, t.note,
            (SELECT string_agg(g.name, ', ' ORDER BY lower(g.name))
             FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.transaction_id = t.id) AS tags
     FROM transactions t
     JOIN wallets w ON w.id = t.wallet_id
     LEFT JOIN categories c ON c.id = t.category_id
     ${filters.where()}
     ORDER BY t.transaction_date, t.id`,
    filters.params,
  );

  const header = ["Date", "Type", "Kind", "Category", "Wallet", "Amount", "Note", "Tags"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [r.transaction_date, r.type, r.origin, r.category, r.wallet, r.amount, r.note, r.tags].map(csvCell).join(","),
    );
  }
  const name = `transactions${q.from ? `-${q.from}` : ""}${q.to ? `-to-${q.to}` : ""}.csv`;
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
});

const escapeHtml = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const money = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

// GET /export/monthly-report.html?month=YYYY-MM
// A printable one-page summary of a month. The mobile app can turn it into a PDF with expo-print
// (Print.printToFileAsync({ html })), or it can simply be opened in a browser and printed.
exportRouter.get("/monthly-report.html", async (c) => {
  const user = c.get("user");
  const monthQuery = c.req.query("month");
  const month = monthQuery === undefined ? monthIn(user.timezone) : requireMonth(monthQuery, "month");
  const { start, end } = monthRange(month);

  const [totals, categories, transactions, budgets, balances] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) AS income,
              COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS expense
       FROM transactions WHERE user_id = $1 AND category_id IS NOT NULL AND transaction_date >= $2 AND transaction_date < $3`,
      [user.id, start, end],
    ),
    pool.query(
      `SELECT c.name, c.type, SUM(t.amount) AS total FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = $1 AND t.transaction_date >= $2 AND t.transaction_date < $3
       GROUP BY c.id ORDER BY c.type DESC, total DESC`,
      [user.id, start, end],
    ),
    pool.query(
      `SELECT t.transaction_date, t.type, t.amount, t.note, t.category_id, c.name AS category, w.name AS wallet
       FROM transactions t JOIN wallets w ON w.id = t.wallet_id LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = $1 AND t.transaction_date >= $2 AND t.transaction_date < $3
       ORDER BY t.transaction_date, t.id`,
      [user.id, start, end],
    ),
    budgetStatus(pool, user.id, user.timezone, month),
    pool.query("SELECT name, balance FROM wallets WHERE user_id = $1 AND archived_at IS NULL ORDER BY id", [user.id]),
  ]);

  const { income, expense } = totals.rows[0];
  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const row = (cells: string[]) => `<tr>${cells.map((x) => `<td>${x}</td>`).join("")}</tr>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(monthName)} — Monthly report</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #2E2723; background: #FBFAF7; margin: 0; padding: 32px; }
  main { max-width: 760px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font-size: 28px; } .sub { color: #858078; margin: 0 0 24px; }
  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 28px; }
  .tile { background: #fff; border: 1px solid #EADCC8; border-radius: 14px; padding: 14px 16px; }
  .tile b { display: block; font-size: 20px; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .in { color: #6F8F72; } .out { color: #C96A4A; }
  h2 { font-size: 16px; margin: 28px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 6px 8px; border-bottom: 1px solid #EADCC8; } td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: #858078; }
  @media print { body { background: #fff; padding: 0; } .tile { break-inside: avoid; } }
</style></head>
<body><main>
  <h1>${escapeHtml(monthName)}</h1>
  <p class="sub">Monthly report for ${escapeHtml(user.name)}</p>
  <div class="tiles">
    <div class="tile">Income<b class="in">${money(income)}</b></div>
    <div class="tile">Expenses<b class="out">${money(expense)}</b></div>
    <div class="tile">Kept<b>${money(income - expense)}</b></div>
  </div>
  <h2>By category</h2>
  <table>${categories.rows.map((r) => row([escapeHtml(r.name), `<span class="muted">${r.type}</span>`, money(r.total)])).join("") || row(['<span class="muted">No income or expenses this month.</span>', "", ""])}</table>
  ${budgets.length > 0 ? `<h2>Budgets</h2><table>${budgets.map((b) => row([escapeHtml(b.category_name ?? "Overall"), `<span class="${b.status === "over" ? "out" : "muted"}">${b.percentage}% used</span>`, `${money(b.spent)} / ${money(b.amount)}`])).join("")}</table>` : ""}
  <h2>Wallets now</h2>
  <table>${balances.rows.map((w) => row([escapeHtml(w.name), "", money(w.balance)])).join("")}</table>
  <h2>All transactions</h2>
  <table>${transactions.rows.map((t) => row([
    escapeHtml(t.transaction_date),
    escapeHtml(t.category ?? (t.category_id === null ? "Transfer / debt" : "")) + (t.note ? ` <span class="muted">· ${escapeHtml(t.note)}</span>` : ""),
    `<span class="muted">${escapeHtml(t.wallet)}</span>`,
    `<span class="${t.type === "income" ? "in" : "out"}">${t.type === "income" ? "+" : "−"}${money(t.amount)}</span>`,
  ])).join("") || row(['<span class="muted">Nothing happened here. Suspicious.</span>', "", "", ""])}</table>
</main></body></html>`;
  return c.html(html);
});
