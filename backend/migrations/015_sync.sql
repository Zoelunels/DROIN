-- Offline sync basics: every synced table gets updated_at (bumped by a trigger on any UPDATE),
-- and every DELETE leaves a tombstone in `deletions`, so GET /sync/changes?since= can tell an
-- offline phone exactly what changed or disappeared.

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE deletions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,      -- no FK: tombstones must survive the row they describe
  entity      VARCHAR(30) NOT NULL,
  entity_id   INTEGER NOT NULL,
  deleted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_deletions_user_time ON deletions(user_id, deleted_at);

CREATE FUNCTION record_deletion() RETURNS trigger AS $$
BEGIN
  INSERT INTO deletions (user_id, entity, entity_id) VALUES (OLD.user_id, TG_ARGV[0], OLD.id);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'wallets', 'categories', 'transactions', 'transfers', 'budgets', 'recurring_rules',
    'goals', 'goal_contributions', 'debts', 'debt_payments', 'tags', 'attachments'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'updated_at'
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now()', t);
      EXECUTE format('UPDATE %I SET updated_at = created_at', t);
    END IF;
    EXECUTE format('CREATE INDEX idx_%s_user_updated ON %I(user_id, updated_at)', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_deleted AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION record_deletion(%L)', t, t, t);
  END LOOP;
END $$;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
