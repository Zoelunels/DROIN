CREATE TABLE wallets (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  balance     NUMERIC(15, 2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);
