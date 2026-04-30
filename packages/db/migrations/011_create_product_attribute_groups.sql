-- 011_create_product_attribute_groups.sql
-- ADR-012 Karar 2 — product_attribute_groups link tablosu (Sprint 8c PR-F1a)
-- HARD DELETE link tablo istisnası (ADR-012 Karar 5): soft-delete kolonu yok.
-- Composite FK'ler: (product_id, tenant_id) ve (group_id, tenant_id) → ON DELETE RESTRICT.

CREATE TABLE IF NOT EXISTS product_attribute_groups (
  id           UUID         PRIMARY KEY,
  tenant_id    UUID         NOT NULL REFERENCES tenants(id),
  product_id   UUID         NOT NULL,
  group_id     UUID         NOT NULL,
  sort_order   SMALLINT     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  FOREIGN KEY (product_id, tenant_id) REFERENCES products (id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (group_id, tenant_id)   REFERENCES attribute_groups (id, tenant_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, product_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_pag_product ON product_attribute_groups(product_id);
CREATE INDEX IF NOT EXISTS idx_pag_group   ON product_attribute_groups(group_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON product_attribute_groups TO app_user;
