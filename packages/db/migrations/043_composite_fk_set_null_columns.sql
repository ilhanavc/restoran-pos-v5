-- 043_composite_fk_set_null_columns.sql
-- Composite ON DELETE SET NULL FK bug sınıfı düzeltmesi (Session 79, task_91d007c7).
-- ADR-003 forward-only: no down migration.
--
-- SORUN: Composite FK'de kolon-listesiz `ON DELETE SET NULL`, parent silinince
-- FK'nin TÜM kolonlarını null'lar — tenant_id (NOT NULL) dahil → 23502
-- not-null violation → parent DELETE 500 ile patlar. Örnek: terminal (paid)
-- siparişi olan bir masa silinemiyordu (hasActiveOrders guard'ı geçse bile).
-- Amaç her zaman yalnız entity-kolonunu null'lamaktı (tenant_id korunur;
-- Migration 030/032 yorumlarında belgelenen niyet — "table_id NULL'a düşer,
-- snapshot kalır"). Bazı akışlar app-level ön-NULL'lama ile maskelenmişti
-- (AreaService.hardDelete area_id'yi kendisi null'lar) ama DB katmanı yanlıştı.
--
-- ÇÖZÜM: PostgreSQL 15+ column-specific SET NULL — `ON DELETE SET NULL (col)`
-- yalnız listelenen kolonu null'lar. CI postgres:17, prod PG 17.10 → güvenli.
-- Aynı bug sınıfını taşıyan 6 composite FK'nin TÜMÜ düzeltilir (tarama:
-- pg_constraint confdeltype='n' AND array_length(conkey,1)>1, hepsinde
-- confdelsetcols boştu). Tanımlar mevcut FK'lerle birebir aynı, yalnız
-- SET NULL kolon listesi eklenir.

-- 1) orders.table_id → tables (masa silinince sipariş kalır, table_id NULL,
--    table_code_snapshot/area_name_snapshot rapor için korunur).
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_table_id_tenant_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_table_id_tenant_id_fkey
  FOREIGN KEY (tenant_id, table_id) REFERENCES tables (tenant_id, id)
  ON DELETE SET NULL (table_id);

-- 2) orders.waiter_user_id → users (garson silinince sipariş kalır).
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_waiter_user_fk;
ALTER TABLE orders ADD CONSTRAINT orders_waiter_user_fk
  FOREIGN KEY (waiter_user_id, tenant_id) REFERENCES users (id, tenant_id)
  ON DELETE SET NULL (waiter_user_id);

-- 3) order_items.created_by_user_id → users (actor silinince kalem kalır,
--    created_by_name snapshot korunur).
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_created_by_user_fk;
ALTER TABLE order_items ADD CONSTRAINT order_items_created_by_user_fk
  FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id)
  ON DELETE SET NULL (created_by_user_id);

-- 4) tables.area_id → areas (bölge silinince masa orphan'a düşer;
--    AreaService.hardDelete'in app-level ön-NULL'laması artık zorunlu değil
--    ama zararsız — DB katmanı da doğru davranır).
ALTER TABLE tables DROP CONSTRAINT IF EXISTS fk_tables_area;
ALTER TABLE tables ADD CONSTRAINT fk_tables_area
  FOREIGN KEY (area_id, tenant_id) REFERENCES areas (id, tenant_id)
  ON DELETE SET NULL (area_id);

-- 5) call_logs.opened_order_id → orders (sipariş silinirse çağrı kaydı kalır).
ALTER TABLE call_logs DROP CONSTRAINT IF EXISTS call_logs_opened_order_fk;
ALTER TABLE call_logs ADD CONSTRAINT call_logs_opened_order_fk
  FOREIGN KEY (opened_order_id, tenant_id) REFERENCES orders (id, tenant_id)
  ON DELETE SET NULL (opened_order_id);

-- 6) call_logs.station_user_id → users (istasyon kullanıcısı silinirse kayıt kalır).
ALTER TABLE call_logs DROP CONSTRAINT IF EXISTS call_logs_station_user_fk;
ALTER TABLE call_logs ADD CONSTRAINT call_logs_station_user_fk
  FOREIGN KEY (station_user_id, tenant_id) REFERENCES users (id, tenant_id)
  ON DELETE SET NULL (station_user_id);
