-- Where a transaction came from. Only 'manual' ones can be edited through /transactions;
-- the others are owned by their transfer or debt and change together with it.
--   manual        normal income/expense (also the ones created by recurring rules)
--   transfer      one side of a transfer between own wallets   (category_id NULL)
--   transfer_fee  admin fee charged on a transfer               (counted as an expense)
--   debt          money lent/borrowed or a debt repayment       (category_id NULL)
ALTER TABLE transactions
  ADD COLUMN origin VARCHAR(15) NOT NULL DEFAULT 'manual'
    CHECK (origin IN ('manual', 'transfer', 'transfer_fee', 'debt'));

UPDATE transactions t SET origin = 'transfer'
WHERE EXISTS (SELECT 1 FROM transfers tf WHERE tf.from_transaction_id = t.id OR tf.to_transaction_id = t.id);

ALTER TABLE transfers
  ADD COLUMN fee                 NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  ADD COLUMN fee_transaction_id  INTEGER UNIQUE REFERENCES transactions(id);
