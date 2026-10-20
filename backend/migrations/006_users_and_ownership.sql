-- Accounts + login sessions, and an owner (user_id) on every existing table.

CREATE TABLE users (
  id                SERIAL PRIMARY KEY,
  email             VARCHAR(255) NOT NULL UNIQUE,      -- always stored lowercase
  password_hash     TEXT,                              -- NULL = cannot log in until a password is set
  name              VARCHAR(100) NOT NULL,
  timezone          VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta',
  reminder_enabled  BOOLEAN NOT NULL DEFAULT false,
  reminder_time     TIME NOT NULL DEFAULT '20:00',
  last_reminded_on  DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Opaque bearer tokens. Only the SHA-256 hash is stored, so a leaked DB dump
-- cannot be used to log in.
CREATE TABLE sessions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    CHAR(64) NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);

ALTER TABLE wallets      ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE categories   ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE transactions ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE transfers    ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Data created before accounts existed is given to an "owner" account.
-- It has no password yet: set one with `bun run set-password owner@localhost <password>`.
DO $$
DECLARE owner_id INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM wallets) OR EXISTS (SELECT 1 FROM categories) THEN
    INSERT INTO users (email, name) VALUES ('owner@localhost', 'Owner') RETURNING id INTO owner_id;
    UPDATE wallets      SET user_id = owner_id;
    UPDATE categories   SET user_id = owner_id;
    UPDATE transactions SET user_id = owner_id;
    UPDATE transfers    SET user_id = owner_id;
  END IF;
END $$;

ALTER TABLE wallets      ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE categories   ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE transfers    ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX idx_wallets_user_id      ON wallets(user_id);
CREATE INDEX idx_categories_user_id   ON categories(user_id);
CREATE INDEX idx_transactions_user_id ON transactions(user_id, transaction_date);
CREATE INDEX idx_transfers_user_id    ON transfers(user_id);

-- Leftover from the first version: keep every timestamp timezone-aware.
-- (Databases created after this change already have TIMESTAMPTZ here.)
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'schema_migrations' AND column_name = 'applied_at') = 'timestamp without time zone' THEN
    ALTER TABLE schema_migrations ALTER COLUMN applied_at TYPE TIMESTAMPTZ USING applied_at AT TIME ZONE 'UTC';
  END IF;
END $$;
