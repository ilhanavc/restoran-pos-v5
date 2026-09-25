-- 060_rls_customer_pii.sql
-- ADR-041 (Tenant İzolasyon — Defense-in-Depth) Faz 4c — müşteri PII.
--
-- Katman 1 (birincil GÜVENLİK garantisi): Postgres Row-Level Security.
-- Kapsam (ADR-041 Amendment 2 F4c):
--   • customers           (müşteri kartı: ad, notlar)
--   • customer_phones     (telefon numaraları — KVKK kişisel veri)
--   • customer_addresses  (adresler — KVKK kişisel veri)
--
-- ⚠️ KVKK-KRİTİK DİLİM: bu üç tablo projedeki en hassas kişisel veriyi tutar
-- (Caller ID eşleşmesi, paket servis adresi). Cross-tenant sızıntı burada
-- yalnız fonksiyonel hata değil, veri koruma ihlalidir.
--
-- ⚠️ Consumer'lar (routes/customers/index.ts, repositories/customers.ts'in
-- kendi tx'ini açan metodları, paket fişi enqueue okumaları) bu PR'da
-- withTenant'a sarıldı. Sipariş akışındaki müşteri okumaları (orders.ts,
-- kds.ts, repositories/orders.ts join'leri) F3a order-tx withTenant
-- context'ini miras alır.
-- (tenant_id, ...) index prefix'leri korunur → RLS policy leading-column uyumu.
--
-- Politika fail-closed: context set edilmezse (boş/unset) hiçbir satır görünmez.
-- `current_setting('app.current_tenant_id', true)` değeri F1 `withTenant`
-- wrapper'ı tarafından her transaction'ın ilk statement'inde `set_config(..., true)`
-- (is_local) ile enjekte edilir → F1 withTenant.ts + migration 054-059 ile birebir.
--
-- Forward-only (ADR-003 §15). Idempotent (ADR-003 §16) — up→up güvenli tekrar.
-- DOWN migration YOK (ev-deseni; runner yalnız `node-pg-migrate up` koşar).
-- ACİL ROLLBACK (prod'da RLS incident'i): operatör manuel çalıştırır —
--   ALTER TABLE public.customer_addresses NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.customer_addresses DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.customer_phones    NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.customer_phones    DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.customers          NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.customers          DISABLE ROW LEVEL SECURITY;
-- (migrator BYPASSRLS geri ALINMAZ; diğer RLS'li tablolar açık kalır.)

-- ⚠️ ÖN-KOŞUL — SUPERUSER, MIGRATION DIŞI (§13.5 bootstrap):
-- migrator zaten BYPASSRLS (F2'de deploy.md §6.1'e taşındı, prod'da bir kez
-- koşuldu, KALICI). F4c ek superuser adımı GEREKTİRMEZ. DDL tablo sahibi
-- migrator ile koşar. `app_tenant` (runtime) NOBYPASSRLS → RLS'e tabidir.

-- === customers ===
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
-- FORCE: tablo sahibi/app rolü bile bypass edemez (yalnız ENABLE yetmez).
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customers_tenant_isolation ON public.customers;
CREATE POLICY customers_tenant_isolation ON public.customers
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- === customer_phones ===
ALTER TABLE public.customer_phones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_phones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_phones_tenant_isolation ON public.customer_phones;
CREATE POLICY customer_phones_tenant_isolation ON public.customer_phones
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- === customer_addresses ===
ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_addresses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_addresses_tenant_isolation ON public.customer_addresses;
CREATE POLICY customer_addresses_tenant_isolation ON public.customer_addresses
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
