-- Split bills: a receipt paid by the user and shared with friends. The user's own share is a normal
-- expense; each friend's share becomes a "receivable" debt (they owe the user), paid back later.

-- People the user splits with often, so they can be picked instead of typed. A one-off "guest"
-- name in a split is not saved here.
CREATE TABLE friends (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(60) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_friends_user_name ON friends(user_id, lower(name));

-- Which friend a debt is with (the name stays in counterparty, also for guests and older debts).
ALTER TABLE debts ADD COLUMN friend_id INTEGER REFERENCES friends(id) ON DELETE SET NULL;
CREATE INDEX idx_debts_friend_id ON debts(friend_id);

CREATE TABLE splits (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(100) NOT NULL,                  -- usually the shop: "Bakso Pak Kumis"
  total           NUMERIC(15, 2) NOT NULL CHECK (total > 0), -- what the user paid for everyone
  split_date      DATE NOT NULL,
  wallet_id       INTEGER NOT NULL REFERENCES wallets(id),
  category_id     INTEGER NOT NULL REFERENCES categories(id),
  -- The user's own share as an expense. NULL when the user had nothing (paid only for others), or
  -- after that entry was deleted on its own.
  transaction_id  INTEGER UNIQUE REFERENCES transactions(id) ON DELETE SET NULL,
  -- What was on the receipt and who had it: [{ "name", "amount", "people": [position, …] }].
  items           JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_splits_user_id ON splits(user_id, split_date DESC);

CREATE TABLE split_people (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  split_id    INTEGER NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,                     -- order in the split; items refer to it
  name        VARCHAR(60) NOT NULL,
  is_me       BOOLEAN NOT NULL DEFAULT false,
  friend_id   INTEGER REFERENCES friends(id) ON DELETE SET NULL,
  share       NUMERIC(15, 2) NOT NULL CHECK (share >= 0),
  -- What this person owes the user (NULL for the user, or if that debt was deleted on its own).
  debt_id     INTEGER UNIQUE REFERENCES debts(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (split_id, position)
);
CREATE INDEX idx_split_people_split_id ON split_people(split_id);

-- Offline sync, as in 015: updated_at bumped on change, a tombstone on delete.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['friends', 'splits', 'split_people'] LOOP
    EXECUTE format('CREATE INDEX idx_%s_user_updated ON %I(user_id, updated_at)', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_deleted AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION record_deletion(%L)', t, t, t);
  END LOOP;
END $$;
