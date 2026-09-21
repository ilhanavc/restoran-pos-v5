-- 057_rls_payments.sql
-- ADR-041 (Tenant İzolasyon — Defense-in-Depth) Faz 3c — ÇEKİRDEK RLS: payments (+ payment_items).
--
-- Katman 1 (birincil GÜVENLİK garantisi): Postgres Row-Level Security.
-- Bu migration payments AİLESİNİ kapsar: `payments` (ADR-041 Amd1 F3c) + `payment_items`
-- (split-payment child, aynı tenant-scope; parent RLS'liyken child'ı bırakmak
-- defense-in-depth boşluğu bırakırdı → aynı dilimde kapatılır). F3a `orders` (055) +
-- F3b `order_items` (056) CANLI. Bu F3'ün son dilimi → tüm çekirdek transactional
-- tablolar RLS'e girer. Diğer tenant-tabloları (customers/products/... ) F4+ açık kalır.
-- Politika fail-closed: context set edilmezse (boş/unset) hiçbir satır görünmez.
-- `current_setting('app.current_tenant_id', true)` değeri F1 `withTenant`
-- wrapper'ı tarafından her transaction'ın ilk statement'inde `set_config(..., true)`
-- (is_local) ile enjekte edilir → F1 withTenant.ts ile birebir tutarlı.
--
-- Forward-only (ADR-003 §15). Idempotent (ADR-003 §16) — up→up güvenli tekrar.
-- DOWN migration YOK (ev-deseni; runner yalnız `node-pg-migrate up` koşar).
-- ACİL ROLLBACK (prod'da RLS incident'i): operatör manuel çalıştırır —
--   ALTER TABLE public.payments      NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE public.payments      DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.payment_items NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE public.payment_items DISABLE ROW LEVEL SECURITY;
-- (migrator BYPASSRLS geri ALINMAZ; diğer RLS'li tablolar açık kalır.)
-- Kalıcı geri alma gerekiyorsa ileri-yönlü yeni bir migration yazılır (§15).

-- ⚠️ ÖN-KOŞUL — SUPERUSER, MIGRATION DIŞI (§13.5 bootstrap):
--   ALTER ROLE migrator BYPASSRLS;
-- Bu adım F2'de (migration 054) `deploy.md §6.1`'e taşındı ve prod'da BİR KEZ
-- koşuldu; KALICI olduğu için F3c ek superuser adımı GEREKTİRMEZ (migrator zaten
-- BYPASSRLS). Aşağıdaki DDL (ENABLE/FORCE/POLICY) tablo sahibi migrator ile
-- koşar (sahiplik yeter, superuser gerekmez). `app_tenant` (runtime API rolü)
-- NOBYPASSRLS kalır → RLS'e tabidir (izolasyonun gerçek uygulayıcısı odur).

-- === payments ===
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
-- FORCE: tablo sahibi/app rolü bile bypass edemez (yalnız ENABLE yetmez).
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_tenant_isolation ON public.payments;
CREATE POLICY payments_tenant_isolation ON public.payments
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- === payment_items ===
ALTER TABLE public.payment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_items_tenant_isolation ON public.payment_items;
CREATE POLICY payment_items_tenant_isolation ON public.payment_items
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
