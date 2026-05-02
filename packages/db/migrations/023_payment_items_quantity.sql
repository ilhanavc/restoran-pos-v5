-- 023_payment_items_quantity.sql
-- ADR-014 §9 Karar 9.4 — partial-quantity kalem bölme (v3 paritesi).
--
-- v3 davranışı (D:\dev\restoran-pos-v3\server\migrations\run.js:274-286):
--   payment_allocations (id, payment_id, order_id, order_item_id,
--                        quantity INTEGER NOT NULL CHECK > 0,
--                        unit_price_snapshot REAL, line_total REAL,
--                        payer_no, payer_label)
--   → 1 order_item için BİRDEN FAZLA allocation izinli (UNIQUE YOK).
--
-- v5 mevcut payment_items (000_init.sql:313-321):
--   composite PK (payment_id, order_item_id) + UNIQUE (tenant_id, order_item_id)
--   → 1 order_item ↔ 1 payment kuralı (v3 paritesi DEĞİL).
--
-- Bu migration:
--   1. quantity INTEGER NOT NULL DEFAULT 1 CHECK > 0 ekler
--   2. unit_price_cents_snapshot INTEGER NOT NULL ekler (audit + recalc)
--   3. line_total_cents INTEGER NOT NULL ekler (= quantity * unit_price snapshot)
--   4. UNIQUE (tenant_id, order_item_id) constraint'i KALDIRIR
--   5. Yeni invariant: SUM(payment_items.quantity) per order_item_id <=
--      order_items.quantity — service katmanında validate (cross-row CHECK
--      karmaşık + performans yükü; service authoritative).
--
-- Mevcut satırlar (yoksa NOOP; varsa) DEFAULT 1 + order_items'dan unit_price
-- backfill. NULL allowed alanlar yok; backfill UPDATE'i NOT NULL ALTER öncesi.
--
-- Forward-only (ADR-003 §15). Idempotent.

-- 1. Kolonları ekle (önce nullable, backfill, sonra NOT NULL)
ALTER TABLE payment_items
  ADD COLUMN IF NOT EXISTS quantity INTEGER NULL,
  ADD COLUMN IF NOT EXISTS unit_price_cents_snapshot INTEGER NULL,
  ADD COLUMN IF NOT EXISTS line_total_cents INTEGER NULL;

-- 2. Backfill: mevcut satırlar (varsa) order_items'dan oku
UPDATE payment_items pi
   SET quantity = COALESCE(pi.quantity, 1),
       unit_price_cents_snapshot = COALESCE(pi.unit_price_cents_snapshot, oi.unit_price_cents),
       line_total_cents = COALESCE(pi.line_total_cents, oi.unit_price_cents * COALESCE(pi.quantity, 1))
  FROM order_items oi
 WHERE pi.order_item_id = oi.id
   AND pi.tenant_id = oi.tenant_id
   AND (pi.quantity IS NULL
        OR pi.unit_price_cents_snapshot IS NULL
        OR pi.line_total_cents IS NULL);

-- 3. NOT NULL + CHECK constraint
ALTER TABLE payment_items
  ALTER COLUMN quantity SET NOT NULL,
  ALTER COLUMN unit_price_cents_snapshot SET NOT NULL,
  ALTER COLUMN line_total_cents SET NOT NULL;

-- CHECK constraint (idempotent için DROP + ADD)
ALTER TABLE payment_items
  DROP CONSTRAINT IF EXISTS payment_items_quantity_positive;
ALTER TABLE payment_items
  ADD CONSTRAINT payment_items_quantity_positive CHECK (quantity > 0);

ALTER TABLE payment_items
  DROP CONSTRAINT IF EXISTS payment_items_line_total_match;
ALTER TABLE payment_items
  ADD CONSTRAINT payment_items_line_total_match
  CHECK (line_total_cents = quantity * unit_price_cents_snapshot);

-- 4. UNIQUE (tenant_id, order_item_id) constraint kaldır — v3 paritesi:
--    aynı order_item N farklı allocation'a bağlanabilir.
ALTER TABLE payment_items
  DROP CONSTRAINT IF EXISTS payment_items_tenant_id_order_item_id_key;

-- 5. Index ekle: kalem-başına allocation lookup (split-state queries için).
CREATE INDEX IF NOT EXISTS payment_items_order_item_idx
  ON payment_items (tenant_id, order_item_id);
