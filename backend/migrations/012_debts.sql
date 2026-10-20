-- Money owed between the user and someone else.
--   payable    = I owe them (I borrowed)
--   receivable = they owe me (I lent)
-- Moving real money (borrowing into a wallet, repaying from a wallet) is optional and creates
-- transactions with origin 'debt' and no category, so it never shows up as income/expense.
CREATE TABLE debts (
  id                      SERIAL PRIMARY KEY,
  user_id                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction               VARCHAR(10) NOT NULL CHECK (direction IN ('payable', 'receivable')),
  counterparty            VARCHAR(100) NOT NULL,
  amount                  NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  debt_date               DATE NOT NULL,
  due_date                DATE,
  note                    TEXT,
  wallet_id               INTEGER REFERENCES wallets(id),
  opening_transaction_id  INTEGER UNIQUE REFERENCES transactions(id),
  settled_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_debts_user_id ON debts(user_id);

CREATE TABLE debt_payments (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  debt_id         INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  amount          NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  payment_date    DATE NOT NULL,
  note            TEXT,
  wallet_id       INTEGER REFERENCES wallets(id),
  transaction_id  INTEGER UNIQUE REFERENCES transactions(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_debt_payments_debt_id ON debt_payments(debt_id);
