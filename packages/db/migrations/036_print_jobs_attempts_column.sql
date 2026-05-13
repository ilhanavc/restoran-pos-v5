-- =============================================================================
-- Migration 036 — print_jobs.attempts kolonu
-- =============================================================================
-- ADR-004 Amendment 1 (2026-05-13, Session 63, PR-2) gereği.
--
-- Bağlam: Print Agent Phase 3 retry/backoff akışı için print job'un kaç kez
-- denendiği audit edilebilir olmalı. `printing → failed` transition'ında
-- attempts artar; karar mantığı (retry vs cancelled) bu sayaca dayanır.
-- `queued → printing` ve `printing → success` transition'larında attempts
-- DEĞİŞMEZ (sırasıyla iş başlangıcı ve final audit hâli).
--
-- Kapsam: salt sayaç kolonu eklemesi + CHECK constraint (0 <= attempts <= 100).
-- Index gerekmez (architect kararı — sorgular tenant+status+created_at üstünden
-- mevcut print_jobs_pending_idx ile karşılanıyor, attempts join key değil).
--
-- Cloud safety: `ADD COLUMN ... NOT NULL DEFAULT 0` PostgreSQL 11+ üstünde
-- "instant" — table rewrite yok, kısa AccessExclusiveLock. CASCADE riski yok.
-- Mevcut satırlar default 0 alır (yeni kolon, sıfır domain etkisi).
--
-- Forward-only (ADR-001 §6.1.6) — rollback yok.
-- =============================================================================

-- 1) Kolon ekleme — NOT NULL DEFAULT 0
ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;

-- 2) CHECK constraint — 0 <= attempts <= 100
--    Üst sınır 100: retry/backoff stratejisi makul ceiling; üzerinde
--    operasyonel hata sinyali (sonsuz döngü guard).
ALTER TABLE print_jobs
  ADD CONSTRAINT print_jobs_attempts_range_chk
  CHECK (attempts >= 0 AND attempts <= 100);

COMMENT ON COLUMN print_jobs.attempts IS
  'ADR-004 Amendment 1: print job deneme sayacı. printing→failed transition''ında +1; queued→printing ve printing→success değişmez. CHECK 0..100 (sonsuz retry guard).';
