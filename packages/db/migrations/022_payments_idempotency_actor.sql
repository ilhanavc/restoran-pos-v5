-- 022_payments_idempotency_actor.sql
-- ADR-014 Karar 4 (idempotency) + actor audit (ADR-013 §5 paritesi).
--
-- payments tablosuna 2 kolon eklenir:
--   1. idempotency_key UUID NOT NULL — UI üretir; aynı (tenant_id, key) ikinci
--      çağrı SAME response döner (replay safety).
--   2. created_by_user_id UUID NULL FK users(id) ON DELETE SET NULL
--      (ADR-002 §10.10 hard delete uyumlu; kullanıcı silinince kanıt kalır).
--
-- Mevcut satırlar (yoksa) NULL/default; yeni siparişler ZORUNLU.
-- DEFAULT YOK; INSERT'lerde domain layer set eder. Mevcut satırlar yoksa
-- (000_init pristine) NOT NULL bozulmaz; satır varsa (mevcut DB) backfill için
-- yeni siparişlerde idempotency_key oluşturulur, eski satırlara
-- gen_random_uuid() ile bir kerelik backfill.
--
-- Forward-only (ADR-003 §15). Idempotent.

-- 1. created_by_user_id (nullable, FK)
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID NULL
    REFERENCES users(id) ON DELETE SET NULL;

-- 2. idempotency_key — önce nullable ekle, mevcut satırları backfill, sonra NOT NULL
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS idempotency_key UUID NULL;

UPDATE payments
   SET idempotency_key = gen_random_uuid()
 WHERE idempotency_key IS NULL;

ALTER TABLE payments
  ALTER COLUMN idempotency_key SET NOT NULL;

-- 3. UNIQUE constraint (tenant_id, idempotency_key) — aynı tenant'ta aynı key
--    iki kez INSERT edilemez; replay durumunda repo SELECT ile mevcut satırı döndürür.
CREATE UNIQUE INDEX IF NOT EXISTS payments_tenant_idempotency_key_uq
  ON payments (tenant_id, idempotency_key);
