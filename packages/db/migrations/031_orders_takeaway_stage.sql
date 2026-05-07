-- 028_orders_takeaway_stage.sql
-- ADR-017 §2 — Paket servis (takeaway) sipariş akışı: stage tracking,
-- planned payment, delivery address snapshot + delivery note.
--
-- Forward-only (ADR-003 §15). Tek tenant MVP'de mevcut satır olmadığı için
-- NOT VALID/backfill gerekmiyor — yeni kolonlar nullable, CHECK constraint
-- type='takeaway' satırlar üzerinde zorlar.
--
-- DİKKAT:
--   - `orders.order_type` ve `orders.customer_id` zaten 000_init.sql'de tanımlı.
--     (Kolon adı `type` DEĞİL, `order_type` — 000_init.sql L252.)
--   - `payment_type` enum 000_init.sql L106'dan re-use ediliyor (cash/card +
--     001_fix_enum_values.sql'de eklenen 'transfer').

-- === 1) takeaway_stage enum ===
CREATE TYPE takeaway_stage AS ENUM ('preparing', 'out_for_delivery', 'delivered');

-- === 2) orders kolonları ===
ALTER TABLE orders ADD COLUMN takeaway_stage             takeaway_stage NULL;
ALTER TABLE orders ADD COLUMN planned_payment_type       payment_type   NULL;
ALTER TABLE orders ADD COLUMN delivery_address_snapshot  TEXT           NULL;
ALTER TABLE orders ADD COLUMN delivery_note              TEXT           NULL;

-- === 3) CHECK constraints ===
-- takeaway siparişlerde stage NOT NULL, diğer tiplerde stage NULL.
ALTER TABLE orders
  ADD CONSTRAINT orders_takeaway_stage_when_takeaway
  CHECK (
    (order_type = 'takeaway' AND takeaway_stage IS NOT NULL)
    OR (order_type <> 'takeaway' AND takeaway_stage IS NULL)
  );

-- takeaway siparişlerde customer_id zorunlu (ADR-017 §2 — anonim takeaway yok).
ALTER TABLE orders
  ADD CONSTRAINT orders_takeaway_customer_when_takeaway
  CHECK (
    (order_type = 'takeaway' AND customer_id IS NOT NULL)
    OR order_type <> 'takeaway'
  );

-- === 4) Partial index — açık takeaway listesi ===
-- Paket servis kuyruğu (open + stage'e göre) hızlı sorgu.
CREATE INDEX idx_orders_takeaway_open
  ON orders (tenant_id, takeaway_stage)
  WHERE order_type = 'takeaway' AND status = 'open';
