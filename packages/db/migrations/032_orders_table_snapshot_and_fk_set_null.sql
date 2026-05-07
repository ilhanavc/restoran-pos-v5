-- 030_orders_table_snapshot_and_fk_set_null.sql
-- ADR-003 + ADR-009 Amendment (2026-05-05) — `tables` & `areas` hard delete pattern.
--
-- Tek tenant restoran sahibi (kullanıcı kendisi) bölge ve masaları silmek istediğinde
-- DB'de soft-delete satırlar birikiyordu (74 boş 0 dolu UI bug'ı, 39 orphan masa).
-- Karar: Seçenek D — hard delete + snapshot pattern (ADR-003 §7 paritesi).
--
-- Bu migration:
--   1. orders.table_code_snapshot + area_name_snapshot kolonları ekler (NULLABLE,
--      no backfill; mevcut satırlar boş kalır, UI fallback ile gösterir).
--   2. orders.table_id FK'sını `ON DELETE NO ACTION` → `ON DELETE SET NULL` çevirir
--      (masa hard delete'inde sipariş kaybolmaz, sadece table_id NULL'a düşer;
--      rapor query'leri `COALESCE(t.code, table_code_snapshot)` ile çalışır).
--
-- Forward-only (ADR-003 §15). Idempotent (ADR-003 §16). DOWN migration yok.
--
-- DİKKAT:
--   - `tables.area_id` FK zaten service-level cascade NULL pattern'inde
--     (ADR-009 Karar 5 hardDelete amendment); DB-level alter gerek yok.
--   - Snapshot doldurma application-level (route handler'larda),
--     trigger değil — `order_items.product_name` pattern'i ile birebir.
--   - Mevcut FK constraint adı: `orders_table_id_tenant_id_fkey` (composite tenant_id, table_id).

-- === 1) Snapshot kolonları (TEXT NULLABLE) ===
ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_code_snapshot TEXT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS area_name_snapshot  TEXT NULL;

-- === 2) FK ALTER: orders.table_id ON DELETE NO ACTION → ON DELETE SET NULL ===
-- Composite FK (tenant_id, table_id). Mevcut constraint'i drop + yeniden create.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_table_id_tenant_id_fkey;
ALTER TABLE orders
  ADD CONSTRAINT orders_table_id_tenant_id_fkey
  FOREIGN KEY (tenant_id, table_id)
  REFERENCES tables (tenant_id, id)
  ON DELETE SET NULL;

-- === 3) Açıklayıcı yorum (PostgreSQL COMMENT) — operasyon zamanında pg_dump'a sızar ===
COMMENT ON COLUMN orders.table_code_snapshot IS
  'Sipariş alındığı andaki tables.code snapshot (ADR-003 §7). Masa hard delete edilince table_id NULL olur ama snapshot kalır → rapor doğru.';
COMMENT ON COLUMN orders.area_name_snapshot IS
  'Sipariş alındığı andaki areas.name snapshot. Bölge hard delete edilince table.area_id NULL, rapor query snapshot''tan okur.';
