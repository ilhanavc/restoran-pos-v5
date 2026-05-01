-- 016_products_sort_order.sql
-- Sprint 8c PR-E4 — V3 paritesi: kategori 3-nokta menü "Ürünleri sırala".
--
-- Eklenen kolon:
-- - sort_order INTEGER NOT NULL DEFAULT 0 — kategori içinde ürünlerin sipariş
--   ekranında görünüm sırası. Bulk reorder endpoint
--   (POST /menu/categories/:id/products/reorder) güncellenir.
--
-- Index gerekçesi: findMany ORDER BY (sort_order, name) sorguları için kompozit
-- index; küçük tablo (<500 ürün) için index opsiyonel ama V5.1'de pagination
-- gelirse query plan'ı optimize eder. WHERE deleted_at IS NULL partial.
--
-- Forward-only (ADR-003 §15). Idempotent.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_products_category_sort_active
  ON products (tenant_id, category_id, sort_order, name)
  WHERE deleted_at IS NULL;
