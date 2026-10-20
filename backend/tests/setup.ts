// Preloaded by `bun test` (see bunfig.toml), before any test file imports the app.
// Recreates a separate test database and runs every migration on it, so tests never touch dev data.
import { Pool } from "pg";

const testUrl =
  process.env.TEST_DATABASE_URL ??
  (process.env.DATABASE_URL ?? "postgres://bukukas:bukukas@localhost:5432/bukukas").replace(/\/[^/?]+(\?|$)/, "/bukukas_test$1");
const dbName = new URL(testUrl).pathname.slice(1);
if (!dbName.endsWith("_test")) throw new Error(`Refusing to wipe "${dbName}": the test database name must end with _test`);

process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = "test";
process.env.PUSH_NOTIFICATIONS = "off";
process.env.UPLOAD_DIR = "uploads-test";

const adminUrl = new URL(testUrl);
adminUrl.pathname = "/postgres";
const admin = new Pool({ connectionString: adminUrl.toString() });
await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
await admin.query(`CREATE DATABASE "${dbName}"`);
await admin.end();

const { pool } = await import("../src/db");
const { runMigrations } = await import("../src/migrate");
await runMigrations(pool, () => {});
