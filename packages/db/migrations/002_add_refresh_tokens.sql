-- 002_add_refresh_tokens.sql
-- ADR-002 Auth: RTR (Refresh Token Rotation) için. Plain token DB'de ASLA tutulmaz.
-- §6.5 composite UNIQUE for FK target consistency.

CREATE TABLE refresh_tokens (
  id            UUID        PRIMARY KEY,
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id       UUID        NOT NULL,
  token_hash    TEXT        NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (user_id, tenant_id) REFERENCES users (id, tenant_id),
  UNIQUE (token_hash)
);

CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id, tenant_id);
CREATE INDEX refresh_tokens_expires_idx ON refresh_tokens (expires_at);

-- Grants (§15.6.B): app_tenant DML, cron_purger DELETE for expired token sweep
GRANT SELECT, INSERT, UPDATE, DELETE ON refresh_tokens TO app_tenant;
GRANT SELECT, DELETE ON refresh_tokens TO cron_purger;
