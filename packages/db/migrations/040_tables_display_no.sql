-- =============================================================================
-- Migration 040 — tables.display_no (kalıcı per-bölge masa-etiketi)
-- =============================================================================
-- ADR-009 Amendment 2026-06-30 — Karar A (Grup 1, #1/#3/#4/#5/#6/#7/#16).
--
-- Bağlam: Masa etiketi için 4 ayrı isim uzayı vardı. Board + sipariş başlığı
-- bölge-içi POZİSYONEL ordinal kullanıyordu (peers `code.localeCompare('tr',
-- {numeric:true})` → index+1 → "Masa N"); kalıcı kimliğe bağlı DEĞİL — masa
-- ekleme/silme/sync sırayı kaydırıyordu. Mutfak fişi/KDS ham `code` snapshot
-- gösteriyordu → board "Masa 4" ama fiş "Masa: 26" → garson yanlış masaya
-- servis yapabiliyordu (veri/operasyon hatası, #1 HIGH).
--
-- Karar: Kalıcı per-bölge `tables.display_no INTEGER NULL` kolonu. Create +
-- sync-tables sırasında `(bölge içinde) MAX(display_no)+1` ile atanır;
-- gap-preserving — silme/sync ile peers YENİDEN numaralanmaz (kalıcı kimlik).
-- Bölgesiz (orphan, area_id NULL) masa → display_no NULL → etiket ham `code`.
--
-- BACKFILL: mevcut (deleted_at IS NULL) + area_id'si olan her masaya, bölge-içi
-- 1..N sıralı numara atanır. Sıralama mevcut görünüm ordinal'iyle BİREBİR olmalı
-- (v3 paritesi korunur): `code`'un sonundaki tamsayı çıkarılıp numeric-aware
-- sıralanır ('MASA 2' < 'MASA 10', lexical DEĞİL). Sayısız code → code sırasına
-- düşer (NULLS LAST + code tie-break). Atama sırası localeCompare('tr',numeric)
-- runtime ordinal'iyle eşleşir → mevcut masaların etiketi DEĞİŞMEZ.
-- Orphan / area_id NULL masalar dokunulmaz (NULL kalır).
--
-- Cloud safety: `ADD COLUMN ... INTEGER` (NULL, default'suz) PostgreSQL üstünde
-- "instant" — table rewrite yok, kısa AccessExclusiveLock. Backfill tek tenant
-- ~25 satır → trivial. Forward-only (ADR-001 §6.1.6) — rollback yok.
-- Idempotent: ADD COLUMN IF NOT EXISTS + backfill yalnız display_no IS NULL
-- satırlara (re-run güvenli).
-- =============================================================================

-- === 1) Kolon (INTEGER NULLABLE) ===
ALTER TABLE tables
  ADD COLUMN IF NOT EXISTS display_no INTEGER;

-- === 2) Backfill — bölge-içi numeric-collated 1..N (mevcut görünüm korunur) ===
-- Yalnız: aktif (deleted_at IS NULL) + area_id NOT NULL + henüz atanmamış.
-- ROW_NUMBER PARTITION BY (tenant_id, area_id), ORDER BY trailing-int NULLS LAST,
-- sonra ham code (sayısız code'lar için deterministik tie-break).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, area_id
      ORDER BY
        NULLIF(regexp_replace(code, '\D', '', 'g'), '')::int NULLS LAST,
        code
    ) AS rn
  FROM tables
  WHERE deleted_at IS NULL
    AND area_id IS NOT NULL
    AND display_no IS NULL
)
UPDATE tables t
   SET display_no = ranked.rn
  FROM ranked
 WHERE t.id = ranked.id;

-- === 3) COMMENT (codegen JSDoc + pg_dump dokümantasyonu) ===
COMMENT ON COLUMN tables.display_no IS
  'ADR-009 Amendment 2026-06-30 Karar A: kalıcı per-bölge masa görüntü numarası. Create/sync sırasında (bölge içinde) MAX+1 ile atanır, gap-preserving (silme/sync ile yeniden numaralanmaz). NULL = orphan/bölgesiz (area_id NULL) masa → etiket ham code''a düşer. tableLabel() util tek etiket kaynağıdır.';
