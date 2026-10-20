import { parseId } from "./validate";

// Builds a dynamic WHERE clause for list endpoints.
// Filter values always go through $n placeholders (never concatenated into SQL) → safe from SQL injection.
export function createFilters() {
  const conditions: string[] = [];
  const params: unknown[] = [];

  return {
    params,
    // Every "?" in sql becomes the placeholder for this value, e.g. add("t.type = ?", "income") → "t.type = $1"
    add(sql: string, value: unknown) {
      params.push(value);
      conditions.push(sql.replaceAll("?", `$${params.length}`));
    },
    // A fixed condition with no user value, e.g. "t.category_id IS NOT NULL".
    addRaw(sql: string) {
      conditions.push(sql);
    },
    where() {
      return conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    },
    // LIMIT/OFFSET from the query string (?limit=&offset=), default 50, max 200.
    // Call this last: it appends its own params after the filter params.
    paginate(query: { limit?: unknown; offset?: unknown }) {
      const limit = query.limit === undefined ? 50 : Math.min(parseId(query.limit, "limit"), 200);
      const offset = query.offset === undefined || query.offset === "0" ? 0 : parseId(query.offset, "offset");
      return { sql: `LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, params: [...params, limit, offset] };
    },
  };
}
