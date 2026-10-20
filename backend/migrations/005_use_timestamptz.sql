-- pg in Node/Bun reads TIMESTAMP (without timezone) as the server's local time,
-- so values shift when the app's timezone differs from the DB's.
-- TIMESTAMPTZ stores an absolute point in time (UTC), so it is correct anywhere.
-- Existing values are treated as UTC (the Postgres container's default timezone).
ALTER TABLE wallets      ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE categories   ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE transactions ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE transfers    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
