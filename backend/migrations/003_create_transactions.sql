CREATE TABLE transactions (
  id                SERIAL PRIMARY KEY,
  wallet_id         INTEGER NOT NULL REFERENCES wallets(id),
  category_id       INTEGER REFERENCES categories(id), -- NULL for transfer legs (and, later, debt movements)
  type              VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
  amount            NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  note              TEXT,
  transaction_date  DATE NOT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT now()
);

-- Postgres does not index foreign keys automatically.
CREATE INDEX idx_transactions_wallet_id ON transactions(wallet_id);
CREATE INDEX idx_transactions_category_id ON transactions(category_id);
CREATE INDEX idx_transactions_date ON transactions(transaction_date);
