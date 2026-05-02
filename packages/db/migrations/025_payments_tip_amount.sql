-- 025_payments_tip_amount.sql
-- ADR-014 §11 Karar 11.3 — bahşiş MVP (Karar 9.3 revizyonu).
--
-- v3 davranışı (D:\dev\restoran-pos-v3\client\src\components\payments\PaymentScreen.jsx):
--   DETAYLI ÖDEME modal'ında BAHŞIŞ input → cash_received = payAmount + tipAmount
--   payments.tip_amount REAL kolonu (run.js:264)
--
-- v5 ek kolon:
--   payments.tip_amount_cents INTEGER NULL CHECK (>= 0)
--
-- v3 ayrı `tips` tablosu MVP'de YOK (rapor için ek detay v5.1 backlog).
--
-- Forward-only (ADR-003 §15). Idempotent.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS tip_amount_cents INTEGER NULL;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_tip_amount_nonneg;
ALTER TABLE payments
  ADD CONSTRAINT payments_tip_amount_nonneg
  CHECK (tip_amount_cents IS NULL OR tip_amount_cents >= 0);
