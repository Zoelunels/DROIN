-- Repeating income/expense (salary, rent, subscriptions).
-- The n-th occurrence is always start_date + n * step, never "previous date + step",
-- so a rule starting on the 31st stays on the last day of short months instead of drifting.
CREATE TABLE recurring_rules (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id         INTEGER NOT NULL REFERENCES wallets(id),
  category_id       INTEGER NOT NULL REFERENCES categories(id),
  type              VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
  amount            NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  note              TEXT,
  frequency         VARCHAR(10) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  interval_count    INTEGER NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 365),
  start_date        DATE NOT NULL,
  end_date          DATE,
  occurrences_done  INTEGER NOT NULL DEFAULT 0,   -- created + skipped occurrences
  next_date         DATE,                         -- NULL = finished (past end_date)
  auto_create       BOOLEAN NOT NULL DEFAULT true,
  paused            BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX idx_recurring_rules_user_id ON recurring_rules(user_id);
CREATE INDEX idx_recurring_rules_next_date ON recurring_rules(next_date) WHERE next_date IS NOT NULL;

ALTER TABLE transactions ADD COLUMN recurring_rule_id INTEGER REFERENCES recurring_rules(id) ON DELETE SET NULL;
CREATE INDEX idx_transactions_recurring_rule_id ON transactions(recurring_rule_id);
