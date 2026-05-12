-- =============================================================================
-- Migration 035 — order_items.updated_at + BEFORE UPDATE trigger
-- =============================================================================
-- ADR-015 Amendment 3 (2026-05-13, Session 61) prereq.
--
-- Bağlam: anomaly endpoint comp scope (Amendment 3 Karar A3.5) için item satırı
-- son güncelleme zamanı kaynak gerek. 000_init.sql ve Migration 019/020/021
-- bu kolonu order_items'a eklemedi; orders tablosunda mevcut (000_init.sql:260),
-- order_items tablosunda yoktu (drift). Bu migration gap'i kapatır.
--
-- Kapsam: salt audit kolonu eklemesi. Yeni domain emit YOK; yeni endpoint YOK.
-- is_comped toggle (PATCH /orders/:id/items/:itemId) sonrası trigger otomatik
-- updated_at = now() yapar; comp anomaly query'si bu kolondan okur.
--
-- Forward-only (ADR-001 §6.1.6) — rollback yok.
-- =============================================================================

-- 1) Kolon ekleme — NOT NULL DEFAULT now() (yeni satırlar için)
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2) Backfill — mevcut satırlarda updated_at = created_at
--    Mevcut DEFAULT now() ile insert edilen mevcut row'lar "yanlış" zamanı
--    taşır (migration anı). created_at zamanına çekilerek comp anomaly
--    geriye dönük listede orijinal pencereyle uyumlu kalır.
UPDATE order_items
   SET updated_at = created_at
 WHERE updated_at <> created_at;

-- 3) Trigger — BEFORE UPDATE → set_updated_at() (000_init.sql:35 mevcut fn)
--    Pattern: orders_set_updated_at trigger ile bit-identical (000_init.sql:266).
DROP TRIGGER IF EXISTS order_items_set_updated_at ON order_items;

CREATE TRIGGER order_items_set_updated_at
  BEFORE UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
