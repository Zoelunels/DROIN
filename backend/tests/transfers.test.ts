import { describe, expect, test } from "bun:test";
import { newUser, today } from "./helpers";

describe("transfers", () => {
  test("transfer with an admin fee moves money and counts only the fee as an expense", async () => {
    const u = await newUser();
    const bca = await u.wallet("BCA", 1_000_000);
    const gopay = await u.wallet("GoPay");

    const res = await u.call("POST", "/transfers", {
      from_wallet_id: bca.id, to_wallet_id: gopay.id, amount: 200_000, fee: 2_500, transfer_date: today(),
    });
    expect(res.status).toBe(201);
    expect(res.data.fee).toBe(2_500);
    expect(await u.balance(bca.id)).toBe(797_500);
    expect(await u.balance(gopay.id)).toBe(200_000);

    const report = (await u.call("GET", `/reports/categories?from=${today()}&to=${today()}&type=expense`)).data;
    expect(report.expense_total).toBe(2_500);
    expect(report.categories[0].category_name).toBe("Admin Fees");

    // The legs cannot be edited through /transactions.
    const legs = (await u.call("GET", `/transactions?wallet_id=${gopay.id}`)).data;
    expect((await u.call("DELETE", `/transactions/${legs[0].id}`)).status).toBe(409);
  });

  test("editing removes/adds the fee and delete restores balances", async () => {
    const u = await newUser();
    const a = await u.wallet("A", 500_000);
    const b = await u.wallet("B", 0);
    const c = await u.wallet("C", 0);
    const tf = (await u.call("POST", "/transfers", { from_wallet_id: a.id, to_wallet_id: b.id, amount: 100_000, fee: 6_500, transfer_date: today() })).data;

    const noFee = await u.call("PUT", `/transfers/${tf.id}`, { from_wallet_id: a.id, to_wallet_id: c.id, amount: 120_000, transfer_date: today() });
    expect(noFee.data.fee_transaction_id).toBeNull();
    expect(await u.balance(a.id)).toBe(380_000);
    expect(await u.balance(b.id)).toBe(0);
    expect(await u.balance(c.id)).toBe(120_000);

    const withFee = await u.call("PUT", `/transfers/${tf.id}`, { from_wallet_id: a.id, to_wallet_id: c.id, amount: 120_000, fee: 2_500, transfer_date: today() });
    expect(withFee.data.fee_transaction_id).not.toBeNull();
    expect(await u.balance(a.id)).toBe(377_500);

    expect((await u.call("DELETE", `/transfers/${tf.id}`)).status).toBe(204);
    expect(await u.balance(a.id)).toBe(500_000);
    expect(await u.balance(c.id)).toBe(0);
  });

  test("same wallet on both sides is refused", async () => {
    const u = await newUser();
    const a = await u.wallet("A", 1);
    const res = await u.call("POST", "/transfers", { from_wallet_id: a.id, to_wallet_id: a.id, amount: 1, transfer_date: today() });
    expect(res.status).toBe(400);
  });
});

describe("idempotency", () => {
  test("a retried POST with the same key creates the transaction only once", async () => {
    const u = await newUser();
    const w = await u.wallet("W", 100_000);
    const body = { wallet_id: w.id, category_id: u.category("Transport"), type: "expense", amount: 20_000, transaction_date: today() };
    const headers = { "Idempotency-Key": crypto.randomUUID() };

    const first = await u.call("POST", "/transactions", body, headers);
    const retry = await u.call("POST", "/transactions", body, headers);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.data.id).toBe(first.data.id);
    expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await u.balance(w.id)).toBe(80_000);

    const misuse = await u.call("POST", "/transactions", { ...body, amount: 1 }, headers);
    expect(misuse.status).toBe(422);
  });

  test("keys are per user", async () => {
    const a = await newUser();
    const b = await newUser();
    const key = { "Idempotency-Key": "shared-key" };
    expect((await a.call("POST", "/tags", { name: "x" }, key)).status).toBe(201);
    expect((await b.call("POST", "/tags", { name: "x" }, key)).status).toBe(201);
  });
});
