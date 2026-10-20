import type { PoolClient } from "pg";
import { HttpError } from "../errors";

// Tag names from the client: "#Bali-Trip " → "Bali-Trip". Duplicates (case-insensitive) are dropped.
export function parseTagNames(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, "tags must be a list of names");
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") throw new HttpError(400, "tags must be a list of names");
    const name = raw.trim().replace(/^#+/, "").trim();
    if (name === "") continue;
    if (name.length > 50) throw new HttpError(400, "A tag can be at most 50 characters");
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      names.push(name);
    }
  }
  if (names.length > 20) throw new HttpError(400, "A transaction can have at most 20 tags");
  return names;
}

// Replace a transaction's tags with `names`, creating tags that do not exist yet.
export async function setTransactionTags(
  client: PoolClient,
  userId: number,
  transactionId: number,
  names: string[],
): Promise<void> {
  await client.query("DELETE FROM transaction_tags WHERE transaction_id = $1", [transactionId]);
  for (const name of names) {
    const { rows } = await client.query(
      `INSERT INTO tags (user_id, name) VALUES ($1, $2)
       ON CONFLICT (user_id, (lower(name))) DO UPDATE SET name = tags.name
       RETURNING id`,
      [userId, name],
    );
    await client.query("INSERT INTO transaction_tags (transaction_id, tag_id) VALUES ($1, $2)", [
      transactionId,
      rows[0].id,
    ]);
  }
  // Tag changes count as a change of the transaction for offline sync.
  await client.query("UPDATE transactions SET updated_at = now() WHERE id = $1", [transactionId]);
}
