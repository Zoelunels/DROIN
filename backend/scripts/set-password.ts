// bun run set-password <email> <new-password>
// Sets (or resets) an account's password from the command line. Used for the "owner@localhost"
// account that migration 006 creates for data made before accounts existed, or when a password
// is forgotten during development. Logs that account out everywhere.
import { hashPassword } from "../src/auth";
import { pool } from "../src/db";

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
  console.error("Usage: bun run set-password <email> <new-password (min 8 characters)>");
  process.exit(1);
}

const { rows } = await pool.query("UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id", [
  await hashPassword(password),
  email.toLowerCase(),
]);
if (rows.length === 0) {
  console.error(`No account with email ${email}`);
  process.exitCode = 1;
} else {
  await pool.query("DELETE FROM sessions WHERE user_id = $1", [rows[0].id]);
  console.log(`Password updated for ${email}.`);
}
await pool.end();
