-- 004_categories_unique_name.sql
-- Sprint 1 DB drift fix: categories tablosunda (tenant_id, name) UNIQUE eksikti.
-- Sprint 1'de eklenen categories.create() repo kodu unique violation → MENU_CATEGORY_ALREADY_EXISTS bekliyor;
-- bu index olmadan duplicate name kabul edilirdi.

-- categories (tenant_id, name) partial unique index
-- Soft-delete saygılı: deleted_at IS NULL olanlar arasında name unique
-- Case-insensitive: 'Yemek' ve 'yemek' aynı sayılır (lower() functional index)
-- ADR-003 §15 forward-only; idempotent re-run kemeri (IF NOT EXISTS) — 005-007 ile tutarlılık.
CREATE UNIQUE INDEX IF NOT EXISTS categories_tenant_name_ci_uq
  ON categories (tenant_id, lower(name))
  WHERE deleted_at IS NULL;
