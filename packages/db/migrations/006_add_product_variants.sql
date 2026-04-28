-- 006_add_product_variants.sql
-- ADR-003 §8.6 (Products/Variants Lifecycle, Amendment 2026-04-27) prerequisite.
-- Phase 2 Sprint 3b Görev 17.5 — Görev 18 (Products/Variants CRUD) öncesi schema-only.
-- ADR-003 §14.1.B.3 (Phase-conditional enforcement) compliant.
-- Phase 0-3 dev ortamı: CREATE INDEX CONCURRENTLY'siz kullanılır (§14.1.B.3 geçici izin).

CREATE TABLE IF NOT EXISTS product_variants (
  id                  UUID         PRIMARY KEY,
  tenant_id           UUID         NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  product_id          UUID         NOT NULL,
  name                TEXT         NOT NULL,
  price_delta_cents   INTEGER      NOT NULL,
  is_default          BOOLEAN      NOT NULL DEFAULT false,
  sort_order          SMALLINT     NOT NULL DEFAULT 0,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (product_id, tenant_id) REFERENCES products (id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS product_variants_tenant_active_idx
  ON product_variants (tenant_id, product_id)
  WHERE deleted_at IS NULL;
