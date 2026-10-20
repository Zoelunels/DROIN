-- Wallet types, icons/colors, archiving, and system categories.

ALTER TABLE wallets
  ADD COLUMN wallet_type  VARCHAR(10) NOT NULL DEFAULT 'other'
    CHECK (wallet_type IN ('cash', 'bank', 'ewallet', 'savings', 'other')),
  ADD COLUMN icon         VARCHAR(50),
  ADD COLUMN color        VARCHAR(7),          -- "#RRGGBB"
  ADD COLUMN archived_at  TIMESTAMPTZ;         -- archived = hidden, history kept

ALTER TABLE categories
  ADD COLUMN icon         VARCHAR(50),
  ADD COLUMN color        VARCHAR(7),
  ADD COLUMN archived_at  TIMESTAMPTZ,
  -- Categories the app relies on (opening balance, transfer fees) are found by key, not by name,
  -- so the user can rename them freely.
  ADD COLUMN system_key   VARCHAR(30);

CREATE UNIQUE INDEX uq_categories_system_key ON categories(user_id, system_key) WHERE system_key IS NOT NULL;
