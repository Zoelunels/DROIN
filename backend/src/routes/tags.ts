import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { pool } from "../db";
import { HttpError, readJson } from "../errors";
import { optionalColor, parseId, requireString } from "../validate";

// Tags are created on the fly when a transaction uses a new name (POST /transactions { tags: [...] }).
// These endpoints list, rename, recolor and delete them.
export const tagsRouter = new Hono<AppEnv>();

// GET /tags — with how many transactions use each tag.
tagsRouter.get("/", async (c) => {
  const { rows } = await pool.query(
    `SELECT g.*, (SELECT count(*)::int FROM transaction_tags tt WHERE tt.tag_id = g.id) AS usage_count
     FROM tags g WHERE g.user_id = $1 ORDER BY lower(g.name)`,
    [c.get("user").id],
  );
  return c.json(rows);
});

tagsRouter.post("/", async (c) => {
  const body = await readJson(c);
  const name = requireString(body?.name, "name", 50).replace(/^#+/, "");
  const { rows } = await pool.query("INSERT INTO tags (user_id, name, color) VALUES ($1, $2, $3) RETURNING *", [
    c.get("user").id,
    name,
    optionalColor(body?.color),
  ]);
  return c.json(rows[0], 201);
});

// Renaming to a name another tag already has → 409 (unique per user, case-insensitive).
tagsRouter.put("/:id", async (c) => {
  const body = await readJson(c);
  const { rows } = await pool.query(
    "UPDATE tags SET name = $1, color = $2 WHERE id = $3 AND user_id = $4 RETURNING *",
    [requireString(body?.name, "name", 50).replace(/^#+/, ""), optionalColor(body?.color), parseId(c.req.param("id")), c.get("user").id],
  );
  if (rows.length === 0) throw new HttpError(404, "Tag not found");
  return c.json(rows[0]);
});

// Removes the tag from every transaction; the transactions themselves stay.
tagsRouter.delete("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  const userId = c.get("user").id;
  // Touch the tagged transactions so offline devices see their tag list changed.
  await pool.query(
    `UPDATE transactions SET updated_at = now()
     WHERE id IN (SELECT transaction_id FROM transaction_tags WHERE tag_id = $1) AND user_id = $2`,
    [id, userId],
  );
  const { rowCount } = await pool.query("DELETE FROM tags WHERE id = $1 AND user_id = $2", [id, userId]);
  if (rowCount === 0) throw new HttpError(404, "Tag not found");
  return c.body(null, 204);
});
