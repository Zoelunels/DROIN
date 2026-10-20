-- Savings goals. Contributions only "earmark" money: they do not move it between wallets
-- or change any balance, so the user can save towards a goal from any wallet.
CREATE TABLE goals (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           VARCHAR(100) NOT NULL,
  target_amount  NUMERIC(15, 2) NOT NULL CHECK (target_amount > 0),
  target_date    DATE,
  icon           VARCHAR(50),
  color          VARCHAR(7),
  archived_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_goals_user_id ON goals(user_id);

CREATE TABLE goal_contributions (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id            INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  amount             NUMERIC(15, 2) NOT NULL CHECK (amount <> 0),   -- negative = withdrawal
  contribution_date  DATE NOT NULL,
  note               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_goal_contributions_goal_id ON goal_contributions(goal_id);
