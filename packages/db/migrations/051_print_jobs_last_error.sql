-- Migration 051 — ADR-004 Amendment 13 (print_jobs.last_error — agent'ın zaten
-- gönderdiği hata metnini artık DB'ye yazıyoruz)
--
-- Forward-only (ADR-003 §9.5c) — DOWN migration yok.
--
-- NEDEN: Canlı vaka (2026-07-31, Masa 8 / Adisyon 43) — ızgara fişi 3 denemeden
-- sonra 'cancelled' oldu, ama NEDEN başarısız olduğu hiçbir yerde kayıtlı değildi.
-- Kök neden: apps/print-agent zaten `POST /print/v1/jobs/:id/result` ile
-- `errorText` gönderiyordu (payload eksik / base64 hatası / yazıcı transport
-- hatası) ama API handler'ı bu alanı okuyup hiçbir yere yazmıyordu —
-- shared-types/print-agent.ts:157 JSDoc'u zaten "Phase 4+'da audit log'a
-- yazılacak" diyordu, hiç yazılmadı.
--
-- VERİ ETKİSİ: mevcut satırlarda last_error NULL kalır (geçmiş hatalar
-- kurtarılamaz — yalnız bundan sonraki hatalar yakalanır). Backfill YOK.
-- Tablo küçük, ADD COLUMN (nullable, default yok) anlık.
--
-- GERİ ALMA: kod revert + `ALTER TABLE print_jobs DROP COLUMN last_error;`.

ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS last_error text;

COMMENT ON COLUMN print_jobs.last_error IS
  'Agent''ın son bildirdiği hata metni (ADR-004 Amendment 13). Yalnız errorText geldiğinde üzerine yazılır; success sonrası önceki değer KORUNUR (tarihçe yok, en son hata). PII içeremez (ADR-004 Amendment 1 kısıtı).';
