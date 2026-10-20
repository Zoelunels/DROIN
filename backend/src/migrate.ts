// Simple migration runner: runs the .sql files in migrations/ in order and records the ones
// that ran in the schema_migrations table, so they never run twice.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";

const migrationsDir = join(import.meta.dir, "..", "migrations");

export async function runMigrations(pool: Pool, log: (line: string) => void = console.log): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    VARCHAR(255) PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.filename));
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await Bun.file(join(migrationsDir, file)).text();
    const client = await pool.connect();
    try {
      // Each file runs in 1 DB transaction: if it fails halfway, nothing is half-applied.
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      log(`✓ ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      log(`✗ ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }
}
