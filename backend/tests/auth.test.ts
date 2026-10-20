import { describe, expect, test } from "bun:test";
import { api, newUser } from "./helpers";

describe("auth", () => {
  test("register returns a token and seeds default categories", async () => {
    const u = await newUser();
    expect(u.token.length).toBeGreaterThan(20);
    const categories = (await u.call("GET", "/categories")).data;
    expect(categories.length).toBeGreaterThanOrEqual(15);
    expect(categories.find((c: any) => c.system_key === "opening_balance")?.name).toBe("Opening Balance");
    expect(categories.every((c: any) => c.icon && c.color)).toBe(true);
  });

  test("duplicate email is refused", async () => {
    const u = await newUser();
    const res = await api("POST", "/auth/register", { body: { email: u.email.toUpperCase(), password: "password123", name: "X" } });
    expect(res.status).toBe(409);
  });

  test("login works with the right password only", async () => {
    const u = await newUser();
    expect((await api("POST", "/auth/login", { body: { email: u.email, password: "wrong-password" } })).status).toBe(401);
    const ok = await api("POST", "/auth/login", { body: { email: u.email, password: "password123" } });
    expect(ok.status).toBe(200);
    expect(ok.data.user.email).toBe(u.email);
    expect(ok.data.user.password_hash).toBeUndefined();
  });

  test("protected endpoints need a valid token", async () => {
    expect((await api("GET", "/wallets")).status).toBe(401);
    expect((await api("GET", "/wallets", { token: "nope" })).status).toBe(401);
  });

  test("logout invalidates the token", async () => {
    const u = await newUser();
    expect((await u.call("POST", "/auth/logout")).status).toBe(204);
    expect((await u.call("GET", "/auth/me")).status).toBe(401);
  });

  test("users cannot see or touch each other's data", async () => {
    const a = await newUser();
    const b = await newUser();
    const wallet = await a.wallet("Cash", 100_000);
    expect((await b.call("GET", `/wallets/${wallet.id}`)).status).toBe(404);
    expect((await b.call("GET", "/wallets")).data).toEqual([]);
    const spend = await b.call("POST", "/transactions", {
      wallet_id: wallet.id, category_id: b.category("Food & Drinks"), type: "expense", amount: 1, transaction_date: "2026-10-01",
    });
    expect(spend.status).toBe(400);
    expect(await a.balance(wallet.id)).toBe(100_000);
  });

  test("profile update and password change", async () => {
    const u = await newUser();
    const me = await u.call("PUT", "/auth/me", { name: "Renamed", timezone: "Asia/Makassar" });
    expect(me.data.name).toBe("Renamed");
    expect(me.data.timezone).toBe("Asia/Makassar");
    expect((await u.call("PUT", "/auth/me", { timezone: "Mars/Olympus" })).status).toBe(400);

    expect((await u.call("PUT", "/auth/password", { current_password: "bad", new_password: "newpassword1" })).status).toBe(400);
    expect((await u.call("PUT", "/auth/password", { current_password: "password123", new_password: "newpassword1" })).status).toBe(204);
    expect((await api("POST", "/auth/login", { body: { email: u.email, password: "newpassword1" } })).status).toBe(200);
  });
});
