-- 008_create_attribute_groups.sql
-- ADR-012 Karar 2 — attribute_groups (Sprint 8c PR-F1a)
-- v3 paritesi: ürün özellik grupları (Boy, Pişme, Acılık vb.)
-- Soft-delete: deleted_at TIMESTAMPTZ NULL (ADR-003 §8 disiplini).
-- Partial UNIQUE name (tenant scope, case-insensitive trimmed) — areas pattern.

CREATE TABLE IF NOT EXISTS attribute_groups (
  id              UUID         PRIMARY KEY,
  tenant_id       UUID         NOT NULL REFERENCES tenants(id),
  name            TEXT         NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 60),
  selection_type  TEXT         NOT NULL CHECK (selection_type IN ('single', 'multiple')),
  is_required     BOOLEAN      NOT NULL DEFAULT false,
  sort_order      SMALLINT     NOT NULL DEFAULT 0,
  deleted_at      TIMESTAMPTZ  NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);

-- v3 paritesi: case-insensitive name uniqueness (aktif satırlar)
CREATE UNIQUE INDEX IF NOT EXISTS attribute_groups_tenant_name_active_uq
  ON attribute_groups (tenant_id, lower(trim(name)))
  WHERE deleted_at IS NULL;

-- Privileges: app_tenant otomatik (000_init.sql ALTER DEFAULT PRIVILEGES).
