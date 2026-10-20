import { describe, expect, test } from "bun:test";
import { nextDateAfter, occurrenceDate, occurrencesBefore } from "../src/services/recurring";
import { addDays, addMonths } from "../src/time";
import { newUser, thisMonth, today } from "./helpers";

describe("budgets", () => {
  test("status shows spent, remaining and over/warning", async () => {
    const u = await newUser();
    const w = await u.wallet("W", 2_000_000);
    const food = u.category("Food & Drinks");
    expect((await u.call("POST", "/budgets", { category_id: food, amount: 100_000 })).status).toBe(201);
    expect((await u.call("POST", "/budgets", { amount: 1_000_000 })).status).toBe(201);
    expect((await u.call("POST", "/budgets", { category_id: food, amount: 5 })).status).toBe(409);
    expect((await u.call("POST", "/budgets", { category_id: u.category("Salary"), amount: 5 })).status).toBe(400);

    await u.spend(w.id, 85_000);
    let status = (await u.call("GET", `/budgets/status?month=${thisMonth()}`)).data.budgets;
    const foodBudget = () => status.find((b: any) => b.category_id === food);
    expect(foodBudget().spent).toBe(85_000);
    expect(foodBudget().status).toBe("warning");
    expect(foodBudget().days_left).toBeGreaterThan(0);

    await u.spend(w.id, 30_000);
    status = (await u.call("GET", "/budgets/status")).data.budgets;
    expect(foodBudget().status).toBe("over");
    expect(foodBudget().remaining).toBe(-15_000);
    expect(status.find((b: any) => b.category_id === null).spent).toBe(115_000);
  });
});

describe("recurring", () => {
  test("monthly dates stay on the month end instead of drifting", () => {
    const dates = [0, 1, 2, 3].map((n) => occurrenceDate("2026-01-31", "monthly", 1, n));
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(occurrenceDate("2024-02-29", "yearly", 1, 1)).toBe("2025-02-28");
    expect(occurrenceDate("2026-10-01", "weekly", 2, 2)).toBe("2026-10-29");
    expect(nextDateAfter({ start_date: "2026-01-01", frequency: "monthly", interval_count: 1, end_date: "2026-02-15" }, 2)).toBeNull();
    expect(occurrencesBefore({ start_date: "2026-01-10", frequency: "monthly", interval_count: 1 }, "2026-03-10")).toBe(2);
  });

  test("an auto rule with a past start date catches up right away", async () => {
    const u = await newUser();
    const w = await u.wallet("W", 0);
    const start = addDays(today(), -14);
    const rule = await u.call("POST", "/recurring", {
      wallet_id: w.id, category_id: u.category("Salary"), type: "income", amount: 1_000,
      frequency: "weekly", start_date: start,
    });
    expect(rule.status).toBe(201);
    // start, start+7, start+14 (= today)
    expect(rule.data.occurrences_done).toBe(3);
    expect(rule.data.next_date).toBe(addDays(today(), 7));
    expect(await u.balance(w.id)).toBe(3_000);
    // Running again creates nothing new.
    expect((await u.call("POST", "/recurring/run")).data.created).toBe(0);
  });

  test("a manual rule waits for confirm or skip", async () => {
    const u = await newUser();
    const w = await u.wallet("W", 500_000);
    const rule = (await u.call("POST", "/recurring", {
      wallet_id: w.id, category_id: u.category("Housing"), type: "expense", amount: 100_000,
      frequency: "monthly", start_date: today(), auto_create: false, note: "Rent",
    })).data;
    expect(await u.balance(w.id)).toBe(500_000);

    const due = (await u.call("GET", "/recurring/due")).data;
    expect(due.due.map((r: any) => r.id)).toContain(rule.id);

    const confirmed = await u.call("POST", `/recurring/${rule.id}/confirm`, { amount: 120_000 });
    expect(confirmed.status).toBe(201);
    expect(confirmed.data.transaction.recurring_rule_id).toBe(rule.id);
    expect(confirmed.data.rule.next_date).toBe(addMonths(today(), 1));
    expect(await u.balance(w.id)).toBe(380_000);

    const skipped = await u.call("POST", `/recurring/${rule.id}/skip`);
    expect(skipped.data.next_date).toBe(addMonths(today(), 2));
    expect(await u.balance(w.id)).toBe(380_000);
  });
});

describe("goals", () => {
  test("contributions drive progress and withdrawals are capped", async () => {
    const u = await newUser();
    const goal = (await u.call("POST", "/goals", {
      name: "Laptop", target_amount: 10_000_000, target_date: addMonths(today(), 4), initial_amount: 2_000_000,
    })).data;
    expect(goal.saved_amount).toBe(2_000_000);
    expect(goal.progress).toBe(20);
    expect(goal.monthly_needed).toBe(1_600_000); // 8jt over 5 months (incl. this one)

    const after = await u.call("POST", `/goals/${goal.id}/contributions`, { amount: 500_000 });
    expect(after.data.saved_amount).toBe(2_500_000);
    expect((await u.call("POST", `/goals/${goal.id}/contributions`, { amount: 9_000_000, type: "withdraw" })).status).toBe(400);
    const done = await u.call("POST", `/goals/${goal.id}/contributions`, { amount: 7_500_000 });
    expect(done.data.completed).toBe(true);
    expect((await u.call("GET", `/goals/${goal.id}/contributions`)).data).toHaveLength(3);
  });
});

describe("debts", () => {
  test("borrowing and repaying moves money but is never income/expense", async () => {
    const u = await newUser();
    const w = await u.wallet("W", 100_000);
    const debt = (await u.call("POST", "/debts", {
      direction: "payable", counterparty: "Budi", amount: 300_000, wallet_id: w.id, due_date: addDays(today(), 3),
    })).data;
    expect(debt.status).toBe("open");
    expect(await u.balance(w.id)).toBe(400_000);

    const partly = await u.call("POST", `/debts/${debt.id}/payments`, { amount: 100_000, wallet_id: w.id });
    expect(partly.data.remaining).toBe(200_000);
    expect(await u.balance(w.id)).toBe(300_000);
    expect((await u.call("POST", `/debts/${debt.id}/payments`, { amount: 999_999, wallet_id: w.id })).status).toBe(400);

    const settled = await u.call("POST", `/debts/${debt.id}/payments`, { amount: 200_000 });
    expect(settled.data.status).toBe("settled");
    expect(settled.data.settled_at).not.toBeNull();

    const report = (await u.call("GET", `/reports/categories?from=${today()}&to=${today()}`)).data;
    expect(report.expense_total).toBe(0);
    expect(report.income_total).toBe(100_000); // only the opening balance

    expect((await u.call("GET", "/debts/summary")).data.open_count).toBe(0);
    expect((await u.call("DELETE", `/debts/${debt.id}`)).status).toBe(204);
    expect(await u.balance(w.id)).toBe(100_000);
  });

  test("lending is a receivable and shows in the summary", async () => {
    const u = await newUser();
    const w = await u.wallet("W", 100_000);
    await u.call("POST", "/debts", { direction: "receivable", counterparty: "Sari", amount: 40_000, wallet_id: w.id });
    expect(await u.balance(w.id)).toBe(60_000);
    const summary = (await u.call("GET", "/debts/summary")).data;
    expect(summary.receivable_remaining).toBe(40_000);
    expect(summary.net).toBe(40_000);
  });
});
