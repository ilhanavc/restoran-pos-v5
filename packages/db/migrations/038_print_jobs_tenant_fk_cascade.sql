-- =============================================================================
-- Migration 038 — print_jobs.tenant_id FK ON DELETE CASCADE
-- =============================================================================
-- ADR-004 Phase 3 PR-4b (2026-05-14, Session 65) fix.
--
-- Bağlam: 000_init.sql'de print_jobs.tenant_id FK NO ACTION default'ta
-- yaratılmış. PR-4b KDS hook'ları her order create'te print_jobs row
-- INSERT ediyor. Test fixture'ları `DELETE FROM tenants` ile cleanup
-- yaparken FK ihlali (23503) — tenant silinmeden önce print_jobs satırları
-- referansta kalıyor.
--
-- Çözüm: agents tablosu ile aynı pattern — ON DELETE CASCADE.
-- Multi-tenant izolasyon hijyeni: tenant silinince print_jobs otomatik
-- temizlenir. Production'da tenant silme operasyonu çoğunlukla yok ama
-- hard-delete senaryolarında veri tutarlılığını garanti eder.
--
-- Cloud safety: DROP+ADD CONSTRAINT, ALTER TABLE AccessExclusiveLock
-- alır (kısa); table rewrite yok (sadece FK metadata). PG 11+ instant.
-- Forward-only (ADR-001 §6.1.6) — geri dönmek için 039 yazılır.
-- =============================================================================

ALTER TABLE print_jobs
  DROP CONSTRAINT IF EXISTS print_jobs_tenant_id_fkey;

ALTER TABLE print_jobs
  ADD CONSTRAINT print_jobs_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
