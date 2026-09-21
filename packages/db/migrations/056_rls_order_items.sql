-- 056_rls_order_items.sql
-- ADR-041 (Tenant İzolasyon — Defense-in-Depth) Faz 3b — ÇEKİRDEK RLS: order_items.
--
-- Katman 1 (birincil GÜVENLİK garantisi): Postgres Row-Level Security.
-- Bu migration YALNIZ `order_items` tablosunu kapsar (F3b). F3a `orders` (055)
-- CANLI; F3c `payments` ayrı migration'da açılır (ADR-041 Amd1 tablo-tablo slicing).
-- Politika fail-closed: context set edilmezse (boş/unset) hiçbir satır görünmez.
-- `current_setting('app.current_tenant_id', true)` değeri F1 `withTenant`
-- wrapper'ı tarafından her transaction'ın ilk statement'inde `set_config(..., true)`
-- (is_local) ile enjekte edilir → F1 withTenant.ts ile birebir tutarlı.
--
-- Forward-only (ADR-003 §15). Idempotent (ADR-003 §16) — up→up güvenli tekrar.
-- DOWN migration YOK (ev-deseni; runner yalnız `node-pg-migrate up` koşar).
-- ACİL ROLLBACK (prod'da RLS incident'i): operatör manuel çalıştırır —
--   ALTER TABLE public.order_items NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE public.order_items DISABLE ROW LEVEL SECURITY;
-- (migrator BYPASSRLS geri ALINMAZ; diğer RLS'li tablolar açık kalır.)
-- Kalıcı geri alma gerekiyorsa ileri-yönlü yeni bir migration yazılır (§15).

-- ⚠️ ÖN-KOŞUL — SUPERUSER, MIGRATION DIŞI (§13.5 bootstrap):
--   ALTER ROLE migrator BYPASSRLS;
-- Bu adım F2'de (migration 054) `deploy.md §6.1`'e taşındı ve prod'da BİR KEZ
-- koşuldu; KALICI olduğu için F3b ek superuser adımı GEREKTİRMEZ (migrator zaten
-- BYPASSRLS). Aşağıdaki DDL (ENABLE/FORCE/POLICY) tablo sahibi migrator ile
-- koşar (sahiplik yeter, superuser gerekmez). `app_tenant` (runtime API rolü)
-- NOBYPASSRLS kalır → RLS'e tabidir (izolasyonun gerçek uygulayıcısı odur).

-- === order_items ===
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
-- FORCE: tablo sahibi/app rolü bile bypass edemez (yalnız ENABLE yetmez).
ALTER TABLE public.order_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_items_tenant_isolation ON public.order_items;
CREATE POLICY order_items_tenant_isolation ON public.order_items
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
