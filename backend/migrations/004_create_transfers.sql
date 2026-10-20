CREATE TABLE transfers (
  id                   SERIAL PRIMARY KEY,
  from_wallet_id       INTEGER NOT NULL REFERENCES wallets(id),
  to_wallet_id         INTEGER NOT NULL REFERENCES wallets(id),
  amount               NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  transfer_date        DATE NOT NULL,
  note                 TEXT,
  from_transaction_id  INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
  to_transaction_id    INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
  created_at           TIMESTAMP NOT NULL DEFAULT now(),
  CHECK (from_wallet_id <> to_wallet_id)
);

CREATE INDEX idx_transfers_from_wallet_id ON transfers(from_wallet_id);
CREATE INDEX idx_transfers_to_wallet_id ON transfers(to_wallet_id);
