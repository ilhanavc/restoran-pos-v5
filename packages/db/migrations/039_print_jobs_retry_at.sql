-- =============================================================================
-- Migration 039 — print_jobs.retry_at kolonu
-- =============================================================================
-- ADR-004 §Amendment 3 (2026-06-27, Session 70) gereği.
--
-- Bağlam: Print Agent reliability defect fix — retry requeue + stuck reclaim.
-- İki sessiz mutfak-fişi kaybı vektörü kapatılır:
--   (A) printing→failed → status='retry' yazılır ama claim sorgusu yalnız
--       'queued' çekerdi → retry job sonsuza kalırdı. retry_at backoff penceresi
--       (10s/20s) geçince claim sorgusu retry job'u doğrudan yeniden 'printing'e
--       alır (cron'suz, lazy — /jobs/next inner SELECT içinde).
--   (B) stuck 'printing' (agent claim sonrası result POST'a ulaşamadan ölürse)
--       updated_at < now()-90s olunca aynı claim sorgusunda reclaim edilir.
--
-- Kapsam: salt nullable timestamp kolonu. retry_at = printing→retry
-- transition'ında now()+make_interval(secs => 10*2^(attempts-1)); queued ve
-- terminal (success/cancelled) durumlarda NULL. order_id / unique index YOK
-- (idempotent enqueue v5.1'e ertelendi — ADR-004 §A3.4).
--
-- Index gerekmez: mevcut print_jobs_pending_idx (tenant_id, created_at)
-- WHERE status IN ('queued','printing','retry') (000_init.sql:457-459) yeni
-- claim filtresinin satır kümesini zaten kapsar.
--
-- Cloud safety: `ADD COLUMN ... TIMESTAMPTZ` (NULL, default'suz) PostgreSQL
-- üstünde "instant" — table rewrite yok, kısa AccessExclusiveLock. Mevcut
-- satırlar NULL alır (queued/terminal job'lar için zaten doğru değer).
--
-- Forward-only (ADR-001 §6.1.6) — rollback yok.
-- =============================================================================

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS retry_at TIMESTAMPTZ;

COMMENT ON COLUMN print_jobs.retry_at IS
  'ADR-004 Amendment 3: retry backoff zamanı. printing→retry transition''ında now()+10s*2^(attempts-1); claim sorgusu retry_at<=now() olunca job''u yeniden printing alır (lazy requeue). queued ve terminal (success/cancelled) durumda NULL.';
