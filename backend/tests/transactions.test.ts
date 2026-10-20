import { describe, expect, test } from "bun:test";
import { newUser, today } from "./helpers";

describe("wallets", () => {
  test("opening balance is recorded as an income transaction", async () => {
    const u = await newUser();
    const wallet = await u.wallet("BCA", 1_500_000, { wallet_type: "bank", icon: "bank", color: "#5b8db8" });
    expect(wallet.balance).toBe(1_500_000);
    expect((wallet as any).color).toBe("#5B8DB8");
    const txs = (await u.call("GET", `/transactions?wallet_id=${wallet.id}`)).data;
    expect(txs).toHaveLength(1);
    expect(txs[0].category_name).toBe("Opening Balance");
  });

  test("archived wallets are hidden and refuse new transactions", async () => {
    const u = await newUser();
    const wallet = await u.wallet("Old", 10_000);
    expect((await u.call("POST", `/wallets/${wallet.id}/archive`)).data.archived_at).not.toBeNull();
    expect((await u.call("GET", "/wallets")).data).toHaveLength(0);
    expect((await u.call("GET", "/wallets?include_archived=true")).data).toHaveLength(1);
    const res = await u.call("POST", "/transactions", {
      wallet_id: wallet.id, category_id: u.category("Food & Drinks"), type: "expense", amount: 1, transaction_date: today(),
    });
    expect(res.status).toBe(400);
    expect(res.data.error).toContain("archived");
    await u.call("POST", `/wallets/${wallet.id}/unarchive`);
    await u.spend(wallet.id, 1);
  });

  test("a wallet with history cannot be deleted", async () => {
    const u = await newUser();
    const wallet = await u.wallet("Cash", 5_000);
    expect((await u.call("DELETE", `/wallets/${wallet.id}`)).status).toBe(409);
    const empty = await u.wallet("Empty");
    expect((await u.call("DELETE", `/wallets/${empty.id}`)).status).toBe(204);
  });
});

describe("transactions", () => {
  test("create → edit → delete keeps the balance exact", async () => {
    const u = await newUser();
    const a = await u.wallet("A", 100_000);
    const b = await u.wallet("B", 50_000);

    const tx = await u.spend(a.id, 25_000.5);
    expect(await u.balance(a.id)).toBe(74_999.5);

    // Change amount, type and wallet at once.
    const edited = await u.call("PUT", `/transactions/${tx.id}`, {
      wallet_id: b.id, category_id: u.category("Salary"), type: "income", amount: 10_000, transaction_date: today(),
    });
    expect(edited.status).toBe(200);
    expect(await u.balance(a.id)).toBe(100_000);
    expect(await u.balance(b.id)).toBe(60_000);

    expect((await u.call("DELETE", `/transactions/${tx.id}`)).status).toBe(204);
    expect(await u.balance(a.id)).toBe(100_000);
    expect(await u.balance(b.id)).toBe(50_000);
  });

  test("category type must match the transaction type", async () => {
    const u = await newUser();
    const w = await u.wallet("W");
    const res = await u.call("POST", "/transactions", {
      wallet_id: w.id, category_id: u.category("Salary"), type: "expense", amount: 1, transaction_date: today(),
    });
    expect(res.status).toBe(400);
  });

  test("tags, search and total count", async () => {
    const u = await newUser();
    const w = await u.wallet("W", 1_000_000);
    const tx = await u.spend(w.id, 30_000, { note: "Nasi goreng Kuta", tags: ["#Bali-Trip", "food", "bali-trip"] });
    expect(tx.tags.map((t: any) => t.name)).toEqual(["Bali-Trip", "food"]);
    await u.spend(w.id, 15_000, { note: "Coffee" });

    const byTag = await u.call("GET", "/transactions?tag=bali-trip");
    expect(byTag.data).toHaveLength(1);
    const search = await u.call("GET", "/transactions?q=goreng");
    expect(search.data[0].id).toBe(tx.id);
    const page = await u.call("GET", "/transactions?limit=1");
    expect(page.data).toHaveLength(1);
    expect(page.headers.get("X-Total-Count")).toBe("3"); // 2 expenses + the opening balance

    // PUT without `tags` keeps them, `tags: []` clears them.
    const body = { wallet_id: w.id, category_id: u.category("Food & Drinks"), type: "expense", amount: 30_000, transaction_date: today() };
    expect((await u.call("PUT", `/transactions/${tx.id}`, body)).data.tags).toHaveLength(2);
    expect((await u.call("PUT", `/transactions/${tx.id}`, { ...body, tags: [] })).data.tags).toHaveLength(0);

    const tags = (await u.call("GET", "/tags")).data;
    expect(tags.find((t: any) => t.name === "Bali-Trip").usage_count).toBe(0);
  });
});
