// bun run migrate — apply the migrations that have not run yet.
import { pool } from "../src/db";
import { runMigrations } from "../src/migrate";

await runMigrations(pool);
console.log("Migrations done.");
await pool.end();
