-- 024_payments_split_v3_parity.sql
-- ADR-014 §10 Karar 10.3 — payments + payment_items extension (v3 paritesi).
--
-- v3 davranışı (D:\dev\restoran-pos-v3\server\migrations\run.js:255-286):
--   payments tablosu: payer_no, payer_label, cash_received, change_amount, note
--   payment_allocations: payer_no, payer_label denormalize
--
-- v5 ek kolonlar (NULL allowed, mevcut satırlar etkilenmez):
--   payments:
--     - payer_no SMALLINT NULL CHECK (payer_no >= 1 AND payer_no <= 999)
--     - payer_label VARCHAR(80) NULL
--     - cash_received_cents INTEGER NULL CHECK (cash_received_cents >= 0)
--     - change_amount_cents INTEGER NULL CHECK (change_amount_cents >= 0)
--     - note VARCHAR(500) NULL
--   payment_items:
--     - payer_no SMALLINT NULL (denormalize, split-state query basitleştirir)
--     - payer_label VARCHAR(80) NULL
--
-- tip_amount_cents EKLENMEZ — Karar 9.3 v5.1 backlog (kullanıcı bahşiş istemiyor).
--
-- Forward-only (ADR-003 §15). Idempotent.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payer_no SMALLINT NULL,
  ADD COLUMN IF NOT EXISTS payer_label VARCHAR(80) NULL,
  ADD COLUMN IF NOT EXISTS cash_received_cents INTEGER NULL,
  ADD COLUMN IF NOT EXISTS change_amount_cents INTEGER NULL,
  ADD COLUMN IF NOT EXISTS note VARCHAR(500) NULL;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_payer_no_range;
ALTER TABLE payments
  ADD CONSTRAINT payments_payer_no_range
  CHECK (payer_no IS NULL OR (payer_no >= 1 AND payer_no <= 999));

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_cash_received_nonneg;
ALTER TABLE payments
  ADD CONSTRAINT payments_cash_received_nonneg
  CHECK (cash_received_cents IS NULL OR cash_received_cents >= 0);

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_change_amount_nonneg;
ALTER TABLE payments
  ADD CONSTRAINT payments_change_amount_nonneg
  CHECK (change_amount_cents IS NULL OR change_amount_cents >= 0);

ALTER TABLE payment_items
  ADD COLUMN IF NOT EXISTS payer_no SMALLINT NULL,
  ADD COLUMN IF NOT EXISTS payer_label VARCHAR(80) NULL;
