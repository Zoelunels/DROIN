import { describe, expect, test } from "bun:test";
import { computeShares } from "../src/services/split";
import { newUser, today } from "./helpers";

describe("split shares", () => {
  test("items split by who had them; tax and service spread in proportion; exact to the rupiah", () => {
    const items = [
      { name: "Bakso", amount: 30_000, people: [0, 1] },
      { name: "Es teh", amount: 5_000, people: [1] },
      { name: "Nasi goreng", amount: 20_000, people: [0] },
    ];
    // Items 55.000, paid 60.500 (10% service): everyone pays 10% more than their items.
    expect(computeShares(60_500, items, 2)).toEqual([38_500, 22_000]);
    // A discount works the same way, the other direction.
    expect(computeShares(45_000, [{ name: "A", amount: 50_000, people: [0, 1] }], 2)).toEqual([22_500, 22_500]);
  });

  test("uneven thirds still add up to the total", () => {
    const shares = computeShares(10_000, [{ name: "Pizza", amount: 10_000, people: [0, 1, 2] }], 3);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
  });
});

describe("POST /splits", () => {
  async function setup() {
    const u = await newUser();
    const wallet = await u.wallet("GoPay", 200_000);
    return { u, wallet, food: u.category("Food & Drinks") };
  }

  const bill = (walletId: number, categoryId: number, people: unknown[]) => ({
    title: "Bakso Pak Kumis",
    total: 60_500,
    split_date: today(),
    wallet_id: walletId,
    category_id: categoryId,
    people,
    items: [
      { name: "Bakso", amount: 30_000, people: [0, 1] },
      { name: "Es teh", amount: 5_000, people: [1] },
      { name: "Nasi goreng", amount: 20_000, people: [0] },
    ],
  });

  test("your share is an expense, a friend's share is what they owe you; the wallet pays the whole bill", async () => {
    const { u, wallet, food } = await setup();
    const res = await u.call("POST", "/splits", bill(wallet.id, food, [{ name: "Me", me: true }, { name: "Budi", save_as_friend: true }]));
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ total: 60_500, my_share: 38_500, owed_to_me: 22_000, settled: false });
    expect(res.data.people.map((p: any) => [p.name, p.share, p.status])).toEqual([["Me", 38_500, "me"], ["Budi", 22_000, "owes"]]);

    expect(await u.balance(wallet.id)).toBe(200_000 - 60_500);
    // Only your share counts as spending.
    const report = (await u.call("GET", `/reports/categories?from=${today()}&to=${today()}&type=expense`)).data;
    expect(report.expense_total).toBe(38_500);
    // Budi is saved as a friend, owing 22.000; the debt says so too.
    const friends = (await u.call("GET", "/friends")).data;
    expect(friends).toMatchObject([{ name: "Budi", owes_you: 22_000 }]);
    const debts = (await u.call("GET", "/debts?direction=receivable")).data;
    expect(debts).toMatchObject([{ counterparty: "Budi", amount: 22_000, friend_id: friends[0].id }]);
  });

  test("a guest isn't saved as a friend; marking paid brings the money back", async () => {
    const { u, wallet, food } = await setup();
    const split = (await u.call("POST", "/splits", bill(wallet.id, food, [{ name: "Me", me: true }, { name: "Sari" }]))).data;
    expect((await u.call("GET", "/friends")).data).toEqual([]);

    const sari = split.people.find((p: any) => p.name === "Sari");
    const paid = await u.call("POST", `/splits/${split.id}/people/${sari.id}/paid`);
    expect(paid.status).toBe(200);
    expect(paid.data).toMatchObject({ owed_to_me: 0, settled: true });
    expect(await u.balance(wallet.id)).toBe(200_000 - 38_500);
    expect((await u.call("POST", `/splits/${split.id}/people/${sari.id}/paid`)).status).toBe(409);
  });

  test("a saved friend can be picked again by id", async () => {
    const { u, wallet, food } = await setup();
    const budi = (await u.call("POST", "/friends", { name: "Budi" })).data;
    const res = await u.call("POST", "/splits", bill(wallet.id, food, [{ name: "Me", me: true }, { name: "Budi", friend_id: budi.id }]));
    expect(res.data.people[1].friend_id).toBe(budi.id);
  });

  test("deleting a split undoes the expense, the debts and repayments", async () => {
    const { u, wallet, food } = await setup();
    const split = (await u.call("POST", "/splits", bill(wallet.id, food, [{ name: "Me", me: true }, { name: "Budi" }]))).data;
    await u.call("POST", `/splits/${split.id}/people/${split.people[1].id}/paid`);
    expect((await u.call("DELETE", `/splits/${split.id}`)).status).toBe(204);
    expect(await u.balance(wallet.id)).toBe(200_000);
    expect((await u.call("GET", "/debts")).data).toEqual([]);
    expect((await u.call("GET", "/splits")).data).toEqual([]);
  });

  test("bad splits are refused with a clear reason", async () => {
    const { u, wallet, food } = await setup();
    const me = { name: "Me", me: true };
    // Someone who had nothing.
    const idle = bill(wallet.id, food, [me, { name: "Budi" }, { name: "Tono" }]);
    expect((await u.call("POST", "/splits", idle)).data.error).toContain("Tono isn't on any item");
    // An item nobody had.
    const orphan = { ...bill(wallet.id, food, [me, { name: "Budi" }]), items: [{ name: "Bakso", amount: 10_000, people: [] }] };
    expect((await u.call("POST", "/splits", orphan)).data.error).toContain("Pick who had");
    // Only you, or two of you.
    expect((await u.call("POST", "/splits", bill(wallet.id, food, [me]))).status).toBe(400);
    expect((await u.call("POST", "/splits", bill(wallet.id, food, [me, { name: "Me 2", me: true }]))).status).toBe(400);
    // Same name twice.
    expect((await u.call("POST", "/splits", bill(wallet.id, food, [me, { name: "budi" }, { name: "Budi" }]))).status).toBe(400);
    // Someone else's wallet or an income category.
    const other = await newUser();
    const theirs = await other.wallet("Theirs", 0);
    expect((await u.call("POST", "/splits", bill(theirs.id, food, [me, { name: "Budi" }]))).status).toBe(400);
    expect((await u.call("POST", "/splits", bill(wallet.id, u.category("Salary"), [me, { name: "Budi" }]))).status).toBe(400);
    expect(await u.balance(wallet.id)).toBe(200_000);
  });
});
