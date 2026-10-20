-- Remembers the response of a POST sent with an Idempotency-Key header, so a retry after a
-- network timeout returns the same result instead of creating a duplicate transaction.
CREATE TABLE idempotency_keys (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key            VARCHAR(255) NOT NULL,
  method         VARCHAR(10) NOT NULL,
  path           TEXT NOT NULL,
  request_hash   CHAR(64) NOT NULL,
  status_code    INTEGER,          -- NULL while the first request is still running
  response_body  TEXT,
  content_type   VARCHAR(100),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idx_idempotency_keys_created_at ON idempotency_keys(created_at);

-- Expo push tokens, one per installed app.
CREATE TABLE push_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       VARCHAR(255) NOT NULL UNIQUE,
  platform    VARCHAR(10) CHECK (platform IN ('ios', 'android', 'web')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_tokens_user_id ON push_tokens(user_id);
