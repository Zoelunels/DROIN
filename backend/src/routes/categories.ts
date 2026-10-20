import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { pool } from "../db";
import { HttpError, readJson } from "../errors";
import { optionalColor, optionalIcon, parseId, queryFlag, requireString, requireType } from "../validate";

export const categoriesRouter = new Hono<AppEnv>();

// GET /categories?type=income&include_archived=true → used by the transaction form to list
// the categories matching the chosen type.
categoriesRouter.get("/", async (c) => {
  const q = c.req.query();
  const params: unknown[] = [c.get("user").id];
  let sql = "SELECT * FROM categories WHERE user_id = $1";
  if (q.type !== undefined) {
    params.push(requireType(q.type));
    sql += ` AND type = $${params.length}`;
  }
  if (!queryFlag(q.include_archived)) sql += " AND archived_at IS NULL";
  const { rows } = await pool.query(`${sql} ORDER BY type, name`, params);
  return c.json(rows);
});

categoriesRouter.get("/:id", async (c) => {
  const { rows } = await pool.query("SELECT * FROM categories WHERE id = $1 AND user_id = $2", [
    parseId(c.req.param("id")),
    c.get("user").id,
  ]);
  if (rows.length === 0) throw new HttpError(404, "Category not found");
  return c.json(rows[0]);
});

categoriesRouter.post("/", async (c) => {
  const body = await readJson(c);
  const { rows } = await pool.query(
    "INSERT INTO categories (user_id, name, type, icon, color) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [c.get("user").id, requireString(body?.name, "name"), requireType(body?.type), optionalIcon(body?.icon), optionalColor(body?.color)],
  );
  return c.json(rows[0], 201);
});

categoriesRouter.put("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  const userId = c.get("user").id;
  const body = await readJson(c);
  const name = requireString(body?.name, "name");
  const type = requireType(body?.type);

  // Changing the type of a category that is already used would make data inconsistent
  // (e.g. an expense transaction in an income category), so it is refused.
  const { rows: used } = await pool.query(
    "SELECT 1 FROM transactions WHERE category_id = $1 AND type <> $2 LIMIT 1",
    [id, type],
  );
  if (used.length > 0) {
    throw new HttpError(409, "The type cannot change because this category is already used by transactions");
  }

  const { rows } = await pool.query(
    `UPDATE categories SET name = $1, type = $2, icon = $3, color = $4
     WHERE id = $5 AND user_id = $6 RETURNING *`,
    [name, type, optionalIcon(body?.icon), optionalColor(body?.color), id, userId],
  );
  if (rows.length === 0) throw new HttpError(404, "Category not found");
  return c.json(rows[0]);
});

// Archive = hide from pickers but keep the history.
categoriesRouter.post("/:id/archive", async (c) => {
  const { rows } = await pool.query(
    "UPDATE categories SET archived_at = COALESCE(archived_at, now()) WHERE id = $1 AND user_id = $2 RETURNING *",
    [parseId(c.req.param("id")), c.get("user").id],
  );
  if (rows.length === 0) throw new HttpError(404, "Category not found");
  return c.json(rows[0]);
});

categoriesRouter.post("/:id/unarchive", async (c) => {
  const { rows } = await pool.query(
    "UPDATE categories SET archived_at = NULL WHERE id = $1 AND user_id = $2 RETURNING *",
    [parseId(c.req.param("id")), c.get("user").id],
  );
  if (rows.length === 0) throw new HttpError(404, "Category not found");
  return c.json(rows[0]);
});

// If the category is still used by transactions, the FK refuses (error 23503 → 409). Archive it instead.
categoriesRouter.delete("/:id", async (c) => {
  const { rowCount } = await pool.query("DELETE FROM categories WHERE id = $1 AND user_id = $2", [
    parseId(c.req.param("id")),
    c.get("user").id,
  ]);
  if (rowCount === 0) throw new HttpError(404, "Category not found");
  return c.body(null, 204);
});
