import { expect } from "bun:test";
import { app } from "../src/app";
import { todayIn } from "../src/time";

export const TZ = "Asia/Jakarta";
export const today = () => todayIn(TZ);
export const thisMonth = () => today().slice(0, 7);

interface RequestOptions {
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

// Calls the Hono app in-process (no server needed) and parses JSON responses.
export async function api(method: string, path: string, { token, body, headers = {} }: RequestOptions = {}) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (token) (init.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await app.request(path, init);
  const type = res.headers.get("Content-Type") ?? "";
  const data = type.includes("application/json") ? await res.json() : await res.text();
  return { status: res.status, data: data as any, headers: res.headers };
}

let counter = 0;

// A brand-new account per test keeps tests independent without wiping tables.
export async function newUser() {
  counter++;
  const email = `user${counter}-${crypto.randomUUID().slice(0, 8)}@test.dev`;
  const res = await api("POST", "/auth/register", {
    body: { email, password: "password123", name: `Tester ${counter}`, timezone: TZ },
  });
  expect(res.status).toBe(201);
  const token: string = res.data.token;

  const categories = (await api("GET", "/categories", { token })).data as any[];
  const category = (name: string) => {
    const found = categories.find((c) => c.name === name);
    if (!found) throw new Error(`No default category "${name}"`);
    return found.id as number;
  };

  return {
    token,
    user: res.data.user,
    email,
    category,
    call: (method: string, path: string, body?: unknown, headers?: Record<string, string>) =>
      api(method, path, { token, body, headers }),
    async wallet(name: string, opening = 0, extra: Record<string, unknown> = {}) {
      const r = await api("POST", "/wallets", { token, body: { name, opening_balance: opening, ...extra } });
      expect(r.status).toBe(201);
      return r.data as { id: number; balance: number; name: string };
    },
    async balance(walletId: number): Promise<number> {
      return (await api("GET", `/wallets/${walletId}`, { token })).data.balance;
    },
    async spend(walletId: number, amount: number, extra: Record<string, unknown> = {}) {
      const r = await api("POST", "/transactions", {
        token,
        body: {
          wallet_id: walletId, category_id: category("Food & Drinks"), type: "expense", amount,
          transaction_date: today(), ...extra,
        },
      });
      expect(r.status).toBe(201);
      return r.data;
    },
  };
}

export type TestUser = Awaited<ReturnType<typeof newUser>>;
