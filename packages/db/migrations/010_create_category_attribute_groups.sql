-- 010_create_category_attribute_groups.sql
-- ADR-012 Karar 2 — category_attribute_groups link tablosu (Sprint 8c PR-F1a)
-- HARD DELETE link tablo istisnası (ADR-012 Karar 5): soft-delete kolonu yok.
-- Composite FK'ler: (category_id, tenant_id) ve (group_id, tenant_id) → ON DELETE RESTRICT.

CREATE TABLE IF NOT EXISTS category_attribute_groups (
  id           UUID         PRIMARY KEY,
  tenant_id    UUID         NOT NULL REFERENCES tenants(id),
  category_id  UUID         NOT NULL,
  group_id     UUID         NOT NULL,
  sort_order   SMALLINT     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  FOREIGN KEY (category_id, tenant_id) REFERENCES categories (id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (group_id, tenant_id)    REFERENCES attribute_groups (id, tenant_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, category_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_cag_category ON category_attribute_groups(category_id);
CREATE INDEX IF NOT EXISTS idx_cag_group    ON category_attribute_groups(group_id);

-- Privileges: app_tenant otomatik (000_init.sql ALTER DEFAULT PRIVILEGES).
