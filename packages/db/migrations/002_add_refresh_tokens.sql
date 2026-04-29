-- 002_add_refresh_tokens.sql
-- ADR-002 §4.2: RTR (Refresh Token Rotation). Plain token DB'de ASLA tutulmaz — sadece SHA-256 hash.
-- ADR-003 §15 forward-only; idempotent re-run kemeri (IF NOT EXISTS) — runner zaten
-- migrations tablosu üzerinden re-run engelliyor, bu kemer 005-007 ile tutarlılık ve
-- cluster taşıma senaryosu için defansif.

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id              UUID        PRIMARY KEY,                      -- uuidv7 app-side (ADR-003 §3)
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id         UUID        NOT NULL,
  token_hash      BYTEA       NOT NULL,                         -- SHA-256(plain_token), 32 byte
  parent_id       UUID        NULL REFERENCES refresh_tokens(id),  -- RTR zinciri (önceki token)
  family_id       UUID        NOT NULL,                         -- aynı login session tüm token'ları
  device_label    TEXT        NULL,                             -- "iPhone 15 - Garson Ahmet" (UI)
  user_agent      TEXT        NULL,
  ip_address      INET        NULL,                             -- KVKK: anomali tespiti; max 37 gün retention
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,                         -- issued_at + 30 gün (sliding)
  last_used_at    TIMESTAMPTZ NULL,
  revoked_at      TIMESTAMPTZ NULL,
  revoked_reason  TEXT        NULL,  -- 'logout'|'rotated'|'reuse_detected'|'admin_force'|'all_sessions'|'user_deleted' (ADR-002 §10.5)
  UNIQUE (id, tenant_id),                                       -- §6.5 composite UNIQUE (FK hedefi için)
  FOREIGN KEY (user_id, tenant_id) REFERENCES users (id, tenant_id),
  CONSTRAINT refresh_tokens_token_hash_uq UNIQUE (token_hash)  -- global: güvenlik gereği (ADR-002 §4.2)
);

-- §6.2 notu: token_hash üzerindeki UNIQUE global tutuldu (tenant_id prefix yok) —
-- SHA-256 hash güvenlik gereği tenant sınırları ötesinde benzersiz olmalı (ADR-002 §4.2 bilinçli karar).

CREATE INDEX IF NOT EXISTS refresh_tokens_user_active_idx
  ON refresh_tokens (tenant_id, user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx
  ON refresh_tokens (family_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS refresh_tokens_expires_idx
  ON refresh_tokens (expires_at)
  WHERE revoked_at IS NULL;

-- Grants (§15.6.B)
GRANT SELECT, INSERT, UPDATE, DELETE ON refresh_tokens TO app_tenant;
GRANT SELECT, DELETE ON refresh_tokens TO cron_purger;
