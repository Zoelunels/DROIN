-- Monthly spending limits. category_id NULL = limit on total spending.
-- A budget applies to every month; spending is computed when it is read.
CREATE TABLE budgets (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id  INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  amount       NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One budget per category, and one overall budget, per user.
CREATE UNIQUE INDEX uq_budgets_category ON budgets(user_id, category_id) WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX uq_budgets_overall ON budgets(user_id) WHERE category_id IS NULL;
