-- 044_payments_void_reopen.sql
-- ADR-033 "Ödeme Düzeltme: Aynı-Gün Ödeme Void + Masa/Adisyon Reopen" — K1 soft-void.
-- ADR-003 forward-only: no down migration.
--
-- Bağlam: bugün payments tablosunda ödeme geri-alma yolu YOK. ADR-033 K1
-- kararı: HARD DELETE + ters/negatif satır REDDEDİLDİ (finansal iz kaybı +
-- idempotency_key UNIQUE kırılır + audit bulanıklaşır). Yerine SOFT-VOID:
-- payment satırı SİLİNMEZ, üç kolonla "geçersiz" işaretlenir. `voided_at IS
-- NOT NULL` = void edilmiş; tüm aritmetik SUM(amount_cents) siteleri bu satırı
-- `voided_at IS NULL` ile dışlar (ADR-033 EN BÜYÜK RİSK — SUM fan-out).
--
-- Backfill YOK: mevcut tüm satırlar voided_at=NULL=aktif kalır (forward-only,
-- ADR-001 §6.1.6). Kolonlar NULL default → ADD COLUMN tablo taramasız (PG 11+
-- non-volatile default; burada default yok = anlık).
--
-- Tek-tenant düşük trafikte ADD COLUMN + CHECK kısa AccessExclusiveLock alır
-- (db-migration-guard onayı; ADR-001 §6.1.6 forward-only). CHECK'ler NOT VALID
-- değil — tablo küçük, backfill yok, mevcut satırlar (hepsi NULL) constraint'i
-- zaten sağlar (all-or-none: üçü de NULL).

-- === 1) Soft-void kolonları ===
-- voided_at        — void anı (UTC). NULL = aktif ödeme.
-- voided_by_user_id — void'ü yapan kasiyer/admin (K6 audit + forensic). ADR-033
--                     K1 gereği users(id) FK (tenant_id kolonu payments'ta zaten
--                     var ama void aktörü herhangi bir kullanıcı olabilir; sade
--                     id FK yeterli — audit_logs actor_user_id ile çapraz izlenir).
-- void_reason_code — zorunlu ENUM (serbest metin DEĞİL — K6 PII sızıntısı önlemi).
ALTER TABLE payments
  ADD COLUMN voided_at TIMESTAMPTZ NULL,
  ADD COLUMN voided_by_user_id UUID NULL REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN void_reason_code TEXT NULL
    CHECK (void_reason_code IN (
      'wrong_payment_type',
      'wrong_amount',
      'wrong_table',
      'duplicate',
      'other'
    ));

-- === 2) All-or-none tutarlılık CHECK (ADR-033 K1) ===
-- `voided_at` ve `void_reason_code` ya HEP NULL (aktif ödeme) ya HEP DOLU (void
-- edilmiş) — void her zaman reason ile atomik yazılır (repo voidPayment tek
-- UPDATE üçünü birlikte set eder). `voided_by_user_id` CHECK'e DAHİL DEĞİL:
-- FK `ON DELETE SET NULL` (yukarıda) void aktörü kullanıcı hard-delete edilince
-- (Migration 018 users hard-delete) actor'ı NULL'a düşürür, ama void kaydı
-- (voided_at + reason) KALIR — CHECK'e dahil olsaydı SET NULL 23514 ile user
-- silmeyi patlatırdı (db-migration-guard bulgusu). Forensic aktör izi zaten
-- `audit_logs.actor_user_id`'de (payment.voided event).
ALTER TABLE payments
  ADD CONSTRAINT payments_void_all_or_none CHECK (
    (voided_at IS NULL) = (void_reason_code IS NULL)
  );

COMMENT ON COLUMN payments.voided_at IS
  'ADR-033: ödeme void anı (UTC). NULL = aktif; NOT NULL = geçersiz (aynı-gün geri alındı). Tüm aritmetik SUM(amount_cents) siteleri voided_at IS NULL ile dışlar.';
COMMENT ON COLUMN payments.voided_by_user_id IS
  'ADR-033: void aktörü (users.id). FK ON DELETE SET NULL — kullanıcı hard-delete edilince NULL''a düşer (void kaydı voided_at+reason ile KALIR). all-or-none CHECK''e DAHİL DEĞİL. Forensic aktör izi audit_logs.actor_user_id''de.';
COMMENT ON COLUMN payments.void_reason_code IS
  'ADR-033 K6: zorunlu void sebebi (enum). wrong_payment_type|wrong_amount|wrong_table|duplicate|other. Serbest metin YOK (PII önlemi).';
