-- 009_create_attribute_options.sql
-- ADR-012 Karar 2 — attribute_options (Sprint 8c PR-F1a)
-- Composite FK (group_id, tenant_id) → attribute_groups (id, tenant_id) ON DELETE RESTRICT.
-- extra_price_cents: signed INTEGER, cap ±10000 (±100 TL) — ADR-012 Karar 4 (İlhan onayı 2026-04-30).
-- Application-level: tek selection_type='single' grup içinde sadece 1 is_default=true (ADR-012 Karar 7).

CREATE TABLE IF NOT EXISTS attribute_options (
  id                 UUID         PRIMARY KEY,
  tenant_id          UUID         NOT NULL REFERENCES tenants(id),
  group_id           UUID         NOT NULL,
  name               TEXT         NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 60),
  extra_price_cents  INTEGER      NOT NULL DEFAULT 0
                                    CHECK (extra_price_cents BETWEEN -10000 AND 10000),
  is_default         BOOLEAN      NOT NULL DEFAULT false,
  sort_order         SMALLINT     NOT NULL DEFAULT 0,
  deleted_at         TIMESTAMPTZ  NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (group_id, tenant_id) REFERENCES attribute_groups (id, tenant_id) ON DELETE RESTRICT
);

-- v3 paritesi: aynı grup içinde case-insensitive name uniqueness (aktif satırlar)
CREATE UNIQUE INDEX IF NOT EXISTS attribute_options_group_name_active_uq
  ON attribute_options (tenant_id, group_id, lower(trim(name)))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attribute_options_group
  ON attribute_options(group_id)
  WHERE deleted_at IS NULL;

-- Privileges: app_tenant otomatik (000_init.sql ALTER DEFAULT PRIVILEGES).
