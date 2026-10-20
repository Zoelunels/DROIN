import type { PoolClient } from "pg";
import type { Db } from "../db";
import { HttpError } from "../errors";
import type { TransactionType } from "../validate";

interface CategorySeed {
  name: string;
  type: TransactionType;
  icon: string;
  color: string;
  systemKey?: SystemCategoryKey;
}

// Categories the app itself depends on. They are looked up by key, so renaming is fine,
// and they are re-created automatically if the user deleted them.
export type SystemCategoryKey = "opening_balance" | "transfer_fee";

const SYSTEM_CATEGORIES: Record<SystemCategoryKey, CategorySeed> = {
  opening_balance: { name: "Opening Balance", type: "income", icon: "wallet", color: "#6F8F72", systemKey: "opening_balance" },
  transfer_fee: { name: "Admin Fees", type: "expense", icon: "receipt", color: "#858078", systemKey: "transfer_fee" },
};

// Every new account starts with these, so the first "add transaction" screen is not empty.
// Icon names are keys the mobile app maps to its icon set.
const DEFAULT_CATEGORIES: CategorySeed[] = [
  { name: "Food & Drinks", type: "expense", icon: "utensils", color: "#F4A259" },
  { name: "Groceries", type: "expense", icon: "basket", color: "#D9A441" },
  { name: "Transport", type: "expense", icon: "bus", color: "#5B8DB8" },
  { name: "Shopping", type: "expense", icon: "shopping-bag", color: "#E07A8B" },
  { name: "Bills & Utilities", type: "expense", icon: "bolt", color: "#C96A4A" },
  { name: "Housing", type: "expense", icon: "home", color: "#B5835A" },
  { name: "Health", type: "expense", icon: "heart", color: "#D9534F" },
  { name: "Entertainment", type: "expense", icon: "film", color: "#9B7EBD" },
  { name: "Education", type: "expense", icon: "book", color: "#4FA3A5" },
  { name: "Gifts & Donations", type: "expense", icon: "gift", color: "#E8A04A" },
  SYSTEM_CATEGORIES.transfer_fee,
  { name: "Other Expenses", type: "expense", icon: "dots", color: "#858078" },
  { name: "Salary", type: "income", icon: "briefcase", color: "#6F8F72" },
  { name: "Bonus", type: "income", icon: "star", color: "#D9A441" },
  { name: "Business", type: "income", icon: "store", color: "#5B8DB8" },
  { name: "Investment", type: "income", icon: "chart", color: "#4FA3A5" },
  { name: "Gifts Received", type: "income", icon: "gift", color: "#E8A04A" },
  SYSTEM_CATEGORIES.opening_balance,
  { name: "Other Income", type: "income", icon: "dots", color: "#858078" },
];

export async function seedDefaultCategories(client: PoolClient, userId: number): Promise<void> {
  for (const c of DEFAULT_CATEGORIES) {
    await client.query(
      `INSERT INTO categories (user_id, name, type, icon, color, system_key) VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, c.name, c.type, c.icon, c.color, c.systemKey ?? null],
    );
  }
}

export async function getSystemCategoryId(client: PoolClient, userId: number, key: SystemCategoryKey): Promise<number> {
  const seed = SYSTEM_CATEGORIES[key];
  await client.query(
    `INSERT INTO categories (user_id, name, type, icon, color, system_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, system_key) WHERE system_key IS NOT NULL DO NOTHING`,
    [userId, seed.name, seed.type, seed.icon, seed.color, key],
  );
  const { rows } = await client.query("SELECT id FROM categories WHERE user_id = $1 AND system_key = $2", [userId, key]);
  return rows[0].id;
}

// The category must belong to the user and match the transaction type.
// Archived categories are refused for new entries unless allowArchived is set.
export async function checkCategory(
  db: Db,
  userId: number,
  categoryId: number,
  type: TransactionType,
  { allowArchived = false } = {},
): Promise<void> {
  const { rows } = await db.query("SELECT name, type, archived_at FROM categories WHERE id = $1 AND user_id = $2", [
    categoryId,
    userId,
  ]);
  const category = rows[0];
  if (!category) throw new HttpError(400, "category_id not found");
  if (category.type !== type) {
    throw new HttpError(400, `This category is for ${category.type}, it does not match a ${type} transaction`);
  }
  if (category.archived_at && !allowArchived) throw new HttpError(400, `Category "${category.name}" is archived`);
}
