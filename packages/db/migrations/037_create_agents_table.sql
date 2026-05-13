-- =============================================================================
-- Migration 037 — agents tablosu (Print Agent kayıt + auth)
-- =============================================================================
-- ADR-004 Amendment 2 (2026-05-13, Session 64, PR-3a) gereği.
--
-- Bağlam: Print Agent Phase 3 register/auth akışı için tenant başına çoklu
-- agent kaydı tutulur. Her agent device_fingerprint ile tanımlanır ve
-- bcrypt-hash'lenmiş api_key ile kimlik doğrular. Revoke (manuel veya
-- otomatik) audit için revoked_at + revoke_reason ile kalıcı işaretlenir.
--
-- Kapsam: salt `CREATE TABLE` + 2 INDEX + UNIQUE constraint + COMMENT'ler.
-- Boş tablo: index'ler anında yaratılır (CONCURRENTLY gereksiz).
-- FK to tenants(id) ON DELETE CASCADE: tenant silinince agent kayıtları
-- otomatik temizlenir (multi-tenant izolasyon hijyeni).
--
-- Cloud safety: yeni tablo → 0 row impact, lock yok.
-- Forward-only (ADR-001 §6.1.6) — rollback yok; gerekirse 038 ile DROP TABLE.
-- =============================================================================

-- 1) Tablo
CREATE TABLE IF NOT EXISTS agents (
  id                  UUID        PRIMARY KEY,
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_fingerprint  TEXT        NOT NULL,
  api_key_hash        TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  revoke_reason       TEXT,
  CONSTRAINT agents_tenant_device_uq UNIQUE (tenant_id, device_fingerprint)
);

-- 2) Indexler
-- Aktif agent listesi (admin UI Phase 4+) — partial index (revoke edilmemişler).
CREATE INDEX IF NOT EXISTS agents_tenant_active_idx
  ON agents (tenant_id)
  WHERE revoked_at IS NULL;

-- Son görülme sıralaması (admin UI Phase 4+ "son aktif agent" listesi).
CREATE INDEX IF NOT EXISTS agents_tenant_lastseen_idx
  ON agents (tenant_id, last_seen_at DESC);

-- 3) COMMENT'ler (codegen JSDoc kaynağı — feedback_codegen_jsdoc_from_comment)
COMMENT ON TABLE agents IS
  'ADR-004 Amendment 2: Print Agent register/auth. Tenant başına çoklu agent; device_fingerprint + bcrypt api_key_hash ile auth. Revoke audit kalıcı (revoked_at + revoke_reason).';

COMMENT ON COLUMN agents.id IS
  'UUIDv7 (application-generated). Time-ordered insert locality için v7 tercih edildi.';

COMMENT ON COLUMN agents.tenant_id IS
  'Tenant FK. ON DELETE CASCADE — tenant silinince agent kayıtları otomatik temizlenir (multi-tenant izolasyon hijyeni).';

COMMENT ON COLUMN agents.device_fingerprint IS
  'Cihaz parmak izi (machine-id + os + hostname türev hash). (tenant_id, device_fingerprint) UNIQUE — aynı cihaz çoklu register engellenir.';

COMMENT ON COLUMN agents.api_key_hash IS
  'API key bcrypt hash (cost 12). Düz key sadece register response''unda bir kez döner; DB''de tutulmaz.';

COMMENT ON COLUMN agents.created_at IS
  'Kayıt zamanı (register endpoint). Audit + onboarding analitiği.';

COMMENT ON COLUMN agents.last_seen_at IS
  'Son heartbeat/auth zamanı (nullable — henüz aktivite yoksa NULL). Admin UI Phase 4+ "son görülme" sıralaması.';

COMMENT ON COLUMN agents.revoked_at IS
  'Revoke zamanı (nullable). NULL = aktif. Set edildiğinde auth reddedilir; kayıt audit için silinmez.';

COMMENT ON COLUMN agents.revoke_reason IS
  'Revoke nedeni serbest metin (manuel admin notu veya otomatik kural çıktısı). NULL iken aktif.';
