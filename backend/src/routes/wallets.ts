import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { pool, withTransaction } from "../db";
import { HttpError, readJson } from "../errors";
import { getSystemCategoryId } from "../services/categories";
import { insertTransaction } from "../services/transactions";
import { todayIn } from "../time";
import {
  optionalColor,
  optionalDate,
  optionalIcon,
  optionalAmount,
  parseId,
  queryFlag,
  requireEnum,
  requireString,
} from "../validate";

export const walletsRouter = new Hono<AppEnv>();

const WALLET_TYPES = ["cash", "bank", "ewallet", "savings", "other"] as const;

function parseDetails(body: any) {
  return {
    name: requireString(body?.name, "name"),
    walletType: body?.wallet_type === undefined ? "other" : requireEnum(body.wallet_type, "wallet_type", WALLET_TYPES),
    icon: optionalIcon(body?.icon),
    color: optionalColor(body?.color),
  };
}

// GET /wallets?include_archived=true — archived wallets are hidden unless asked for.
walletsRouter.get("/", async (c) => {
  const includeArchived = queryFlag(c.req.query("include_archived"));
  const { rows } = await pool.query(
    `SELECT * FROM wallets WHERE user_id = $1 ${includeArchived ? "" : "AND archived_at IS NULL"} ORDER BY id`,
    [c.get("user").id],
  );
  return c.json(rows);
});

walletsRouter.get("/:id", async (c) => {
  const { rows } = await pool.query("SELECT * FROM wallets WHERE id = $1 AND user_id = $2", [
    parseId(c.req.param("id")),
    c.get("user").id,
  ]);
  if (rows.length === 0) throw new HttpError(404, "Wallet not found");
  return c.json(rows[0]);
});

// The balance cannot be set directly: it starts at 0 and only changes through transactions.
// opening_balance (optional) is recorded as an income in the "Opening Balance" category,
// dated opening_date (default: today in the user's timezone).
walletsRouter.post("/", async (c) => {
  const body = await readJson(c);
  const user = c.get("user");
  const details = parseDetails(body);
  const openingBalance = optionalAmount(body?.opening_balance, "opening_balance");
  const openingDate = optionalDate(body?.opening_date, "opening_date") ?? todayIn(user.timezone);

  const wallet = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO wallets (user_id, name, wallet_type, icon, color) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [user.id, details.name, details.walletType, details.icon, details.color],
    );
    const walletId = rows[0].id;
    if (openingBalance > 0) {
      await insertTransaction(client, {
        userId: user.id, walletId, categoryId: await getSystemCategoryId(client, user.id, "opening_balance"),
        type: "income", amount: openingBalance, note: "Opening balance", transactionDate: openingDate, origin: "manual",
      });
    }
    const result = await client.query("SELECT * FROM wallets WHERE id = $1", [walletId]);
    return result.rows[0];
  });
  return c.json(wallet, 201);
});

// Name, type, icon and color can change; the balance is managed by transactions.
walletsRouter.put("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  const details = parseDetails(await readJson(c));
  const { rows } = await pool.query(
    `UPDATE wallets SET name = $1, wallet_type = $2, icon = $3, color = $4
     WHERE id = $5 AND user_id = $6 RETURNING *`,
    [details.name, details.walletType, details.icon, details.color, id, c.get("user").id],
  );
  if (rows.length === 0) throw new HttpError(404, "Wallet not found");
  return c.json(rows[0]);
});

// Archive = hide an old account but keep its history (deleting is only possible without history).
walletsRouter.post("/:id/archive", async (c) => {
  const { rows } = await pool.query(
    "UPDATE wallets SET archived_at = COALESCE(archived_at, now()) WHERE id = $1 AND user_id = $2 RETURNING *",
    [parseId(c.req.param("id")), c.get("user").id],
  );
  if (rows.length === 0) throw new HttpError(404, "Wallet not found");
  return c.json(rows[0]);
});

walletsRouter.post("/:id/unarchive", async (c) => {
  const { rows } = await pool.query(
    "UPDATE wallets SET archived_at = NULL WHERE id = $1 AND user_id = $2 RETURNING *",
    [parseId(c.req.param("id")), c.get("user").id],
  );
  if (rows.length === 0) throw new HttpError(404, "Wallet not found");
  return c.json(rows[0]);
});

// If the wallet still has transactions, the FK refuses (error 23503 → 409). Archive it instead.
walletsRouter.delete("/:id", async (c) => {
  const { rowCount } = await pool.query("DELETE FROM wallets WHERE id = $1 AND user_id = $2", [
    parseId(c.req.param("id")),
    c.get("user").id,
  ]);
  if (rowCount === 0) throw new HttpError(404, "Wallet not found");
  return c.body(null, 204);
});
