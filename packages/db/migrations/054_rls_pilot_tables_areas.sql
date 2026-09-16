-- 054_rls_pilot_tables_areas.sql
-- ADR-041 (Tenant İzolasyon — Defense-in-Depth) Faz 2 — PİLOT RLS.
--
-- Katman 1 (birincil GÜVENLİK garantisi): Postgres Row-Level Security.
-- YALNIZ pilot iki tabloyu (tables + areas) kapsar; F3+ diğer aileleri açar.
-- Politika fail-closed: context set edilmezse (boş/unset) hiçbir satır görünmez.
-- `current_setting('app.current_tenant_id', true)` değeri F1 `withTenant`
-- wrapper'ı tarafından her transaction'ın ilk statement'inde `set_config(..., true)`
-- (is_local) ile enjekte edilir → F1 withTenant.ts ile birebir tutarlı.
--
-- Forward-only (ADR-003 §15). Idempotent (ADR-003 §16) — up→up güvenli tekrar.
-- DOWN migration YOK (ev-deseni; runner yalnız `node-pg-migrate up` koşar).
-- ACİL ROLLBACK (prod'da RLS incident'i): operatör manuel çalıştırır —
--   ALTER TABLE public.tables NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE public.tables DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.areas  NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE public.areas  DISABLE ROW LEVEL SECURITY;
-- (migrator BYPASSRLS geri ALINMAZ; F3+ diğer tablolarda RLS açık kalır.)
-- Kalıcı geri alma gerekiyorsa ileri-yönlü yeni bir migration yazılır (§15).

-- ⚠️ ÖN-KOŞUL — SUPERUSER, MIGRATION DIŞI (§13.5 bootstrap):
--   ALTER ROLE migrator BYPASSRLS;
-- Bu adım BİLİNÇLİ olarak migration'a KONMADI. Gerekçe: BYPASSRLS attribute'unu
-- yalnız SUPERUSER atayabilir; prod migration'ları `migrator` (non-superuser)
-- ile koşar (deploy.md §6) → migration içinde patlar. O yüzden deploy runbook'ta
-- (deploy.md §6.1) migration 054'ten ÖNCE `postgres` superuser ile BİR KEZ
-- koşulur (`app_tenant`/`cron_purger` rol kurulumu gibi). KALICI: F3+'da başka
-- tablolar RLS'e girince migrator BYPASSRLS gereklidir; geri alınmaz.
-- migrator FORCE RLS altında kendi DML'ine takılmasın diye BYPASSRLS alır;
-- `app_tenant` (runtime API rolü) NOBYPASSRLS kalır → RLS'e tabidir (izolasyonun
-- gerçek uygulayıcısı odur). Aşağıdaki DDL (ENABLE/FORCE/POLICY) tablo sahibi
-- migrator ile koşabilir (sahiplik yeter, superuser gerekmez).

-- === tables ===
ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;
-- FORCE: tablo sahibi/app rolü bile bypass edemez (yalnız ENABLE yetmez).
ALTER TABLE public.tables FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tables_tenant_isolation ON public.tables;
CREATE POLICY tables_tenant_isolation ON public.tables
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- === areas ===
ALTER TABLE public.areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.areas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS areas_tenant_isolation ON public.areas;
CREATE POLICY areas_tenant_isolation ON public.areas
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
