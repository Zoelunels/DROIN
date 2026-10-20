import { describe, expect, test } from "bun:test";
import { parseAmount, parseDate } from "../src/services/quickInput";
import { addDays } from "../src/time";
import { newUser, thisMonth, today } from "./helpers";

describe("quick input", () => {
  test("amounts in everyday notation", () => {
    expect(parseAmount("lunch 25k")?.amount).toBe(25_000);
    expect(parseAmount("bensin 50rb")?.amount).toBe(50_000);
    expect(parseAmount("gaji 8,5 jt")?.amount).toBe(8_500_000);
    expect(parseAmount("laptop 1.5jt")?.amount).toBe(1_500_000);
    expect(parseAmount("Rp25.000 parkir")?.amount).toBe(25_000);
    expect(parseAmount("2 coffees 30k")?.amount).toBe(30_000);
    expect(parseAmount("makan siang")).toBeNull();
  });

  test("dates", () => {
    expect(parseDate("kopi kemarin", "2026-10-09")?.date).toBe("2026-10-08");
    expect(parseDate("kemarin lusa", "2026-10-09")?.date).toBe("2026-10-07");
    expect(parseDate("3 days ago", "2026-10-09")?.date).toBe("2026-10-06");
    expect(parseDate("tiket 5/10", "2026-10-09")?.date).toBe("2026-10-05");
  });

  test("parse picks wallet, category and type", async () => {
    const u = await newUser();
    await u.wallet("BCA", 1_000_000);
    const gopay = await u.wallet("GoPay", 100_000);

    const lunch = (await u.call("POST", "/quick-input/parse", { text: "makan siang 25k gopay kemarin" })).data;
    expect(lunch).toMatchObject({
      amount: 25_000, type: "expense", category_name: "Food & Drinks", wallet_id: gopay.id,
      transaction_date: addDays(today(), -1), note: "makan siang",
    });

    const salary = (await u.call("POST", "/quick-input/parse", { text: "gaji 8jt bca" })).data;
    expect(salary.type).toBe("income");
    expect(salary.category_name).toBe("Salary");
    expect(salary.wallet_name).toBe("BCA");

    // History wins: after filing "warteg" under Groceries once, it is suggested again.
    await u.spend(gopay.id, 10_000, { note: "warteg", category_id: u.category("Groceries") });
    const learned = (await u.call("POST", "/quick-input/parse", { text: "warteg 15k" })).data;
    expect(learned.category_name).toBe("Groceries");
    expect(learned.matched.category).toBe("history");
  });
});

describe("reports, insights and export", () => {
  test("daily report covers every day of the month", async () => {
    const u = await newUser();
    const w = await u.wallet("W", 0);
    await u.spend(w.id, 12_000);
    const daily = (await u.call("GET", `/reports/daily?month=${thisMonth()}`)).data;
    expect(daily.days.length).toBeGreaterThanOrEqual(28);
    expect(daily.days.find((d: any) => d.date === today()).expense).toBe(12_000);
  });

  test("insights flag an over-budget category and an empty day", async () => {
    const u = await newUser();
    const insightsEmpty = (await u.call("GET", "/insights")).data.insights;
    expect(insightsEmpty.map((i: any) => i.kind)).toContain("empty_day");

    const w = await u.wallet("W", 1_000_000);
    await u.call("POST", "/budgets", { category_id: u.category("Food & Drinks"), amount: 50_000 });
    await u.spend(w.id, 80_000);
    const insights = (await u.call("GET", "/insights")).data.insights;
    const over = insights.find((i: any) => i.kind === "budget_over");
    expect(over.message).toContain("Rp 30.000");
    expect(insights[0].tone).toBe("warning");
  });

  test("CSV export escapes notes and blocks spreadsheet formulas", async () => {
    const u = await newUser();
    const w = await u.wallet("W", 0);
    await u.spend(w.id, 1_000, { note: '=HYPERLINK("x"), "quoted"' });
    const res = await u.call("GET", "/export/transactions.csv");
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.data).toContain(`"'=HYPERLINK(""x""), ""quoted"""`);
  });

  test("monthly report renders HTML", async () => {
    const u = await newUser();
    const w = await u.wallet("W <script>", 50_000);
    await u.spend(w.id, 1_000);
    const res = await u.call("GET", "/export/monthly-report.html");
    expect(res.status).toBe(200);
    expect(res.data).toContain("Monthly report");
    expect(res.data).not.toContain("<script>");
  });
});

describe("attachments", () => {
  test("upload, list, download and delete a receipt", async () => {
    const u = await newUser();
    const w = await u.wallet("W", 100_000);
    const tx = await u.spend(w.id, 5_000);

    const form = new FormData();
    form.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], "struk.jpg", { type: "image/jpeg" }));
    const up = await u.call("POST", `/transactions/${tx.id}/attachments`, form);
    expect(up.status).toBe(201);
    expect(up.data.original_name).toBe("struk.jpg");
    expect((await u.call("GET", `/transactions/${tx.id}`)).data.attachment_count).toBe(1);

    const download = await u.call("GET", `/attachments/${up.data.id}`);
    expect(download.status).toBe(200);
    expect(download.headers.get("Content-Type")).toBe("image/jpeg");

    const bad = new FormData();
    bad.append("file", new File(["hello"], "x.txt", { type: "text/plain" }));
    expect((await u.call("POST", `/transactions/${tx.id}/attachments`, bad)).status).toBe(415);

    expect((await u.call("DELETE", `/attachments/${up.data.id}`)).status).toBe(204);
    expect((await u.call("GET", `/attachments/${up.data.id}`)).status).toBe(404);
  });
});

describe("sync", () => {
  test("changes since a timestamp include edits and deletions", async () => {
    const u = await newUser();
    const w = await u.wallet("W", 0);
    const tx = await u.spend(w.id, 1_000);

    const full = (await u.call("GET", "/sync/changes")).data;
    expect(full.full).toBe(true);
    expect(full.transactions.length).toBe(1);
    expect(full.categories.length).toBeGreaterThan(10);

    // Make the server_time of the snapshot clearly older than the following changes.
    const since = new Date(Date.parse(full.server_time) - 60_000).toISOString();
    await u.call("DELETE", `/transactions/${tx.id}`);
    const delta = (await u.call("GET", `/sync/changes?since=${encodeURIComponent(since)}`)).data;
    expect(delta.full).toBe(false);
    expect(delta.deleted).toContainEqual(expect.objectContaining({ entity: "transactions", id: tx.id }));
    // The wallet balance changed back, so the wallet is in the delta too.
    expect(delta.wallets.map((x: any) => x.id)).toContain(w.id);
  });
});

describe("notifications", () => {
  test("register a push token and update reminder settings", async () => {
    const u = await newUser();
    expect((await u.call("POST", "/notifications/tokens", { token: "not-a-token" })).status).toBe(400);
    const token = `ExponentPushToken[${crypto.randomUUID()}]`;
    expect((await u.call("POST", "/notifications/tokens", { token, platform: "android" })).status).toBe(201);
    const settings = await u.call("PUT", "/notifications/settings", { reminder_enabled: true, reminder_time: "21:30" });
    expect(settings.data).toMatchObject({ reminder_enabled: true, reminder_time: "21:30" });
    expect((await u.call("PUT", "/notifications/settings", { reminder_time: "25:00" })).status).toBe(400);
    expect((await u.call("DELETE", `/notifications/tokens/${encodeURIComponent(token)}`)).status).toBe(204);
  });
});
