-- 005_orders_add_waiter_user_id.sql
-- ADR-008 §4.1 + ADR-003 §14.1.B.3 (Phase-conditional enforcement) compliant.
-- Phase 0-3 dev ortamı: CREATE INDEX CONCURRENTLY'siz kullanılır (§14.1.B.3 geçici izin).
-- Backfill yok (prod boş, dev seed'de sipariş yok — ADR-008 §4.1).

-- Kolon ekleme (idempotent)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS waiter_user_id UUID NULL;

-- Composite FK — ADR-003 §6.5 (users UNIQUE (id, tenant_id)) hedefli.
-- ON DELETE SET NULL: kullanıcı silinince attribusyon düşer, sipariş business-record olarak korunur.
-- ON UPDATE NO ACTION: UUID immutable (teorik koruma).
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_waiter_user_fk;

ALTER TABLE orders
  ADD CONSTRAINT orders_waiter_user_fk
  FOREIGN KEY (waiter_user_id, tenant_id)
  REFERENCES users (id, tenant_id)
  ON DELETE SET NULL
  ON UPDATE NO ACTION;

-- Partial index — ABAC waiter filter baseline (NULL satırları index dışı).
CREATE INDEX IF NOT EXISTS orders_waiter_user_id_idx
  ON orders (tenant_id, waiter_user_id)
  WHERE waiter_user_id IS NOT NULL;
