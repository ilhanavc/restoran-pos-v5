-- 059_rls_menu_catalog.sql
-- ADR-041 (Tenant İzolasyon — Defense-in-Depth) Faz 4b — menü / katalog.
--
-- Katman 1 (birincil GÜVENLİK garantisi): Postgres Row-Level Security.
-- Kapsam (ADR-041 Amendment 2 F4b):
--   • products                    (ürün kataloğu)
--   • product_variants            (porsiyon/varyant)
--   • product_attribute_groups    (ürün↔özellik-grubu link)
--   • categories                  (kategori)
--   • category_attribute_groups   (kategori↔özellik-grubu link)
--   • attribute_groups            (özellik grubu)
--   • attribute_options           (özellik seçeneği)
--
-- Okuma-ağırlıklı, düşük mutasyon; menü her sipariş ekranında yüklenir.
-- ⚠️ Consumer'lar (routes/products.ts, routes/menu.ts, routes/attribute-groups.ts,
-- domain/attributes/*Service.ts, orders.ts porsiyon-read) bu PR'da withTenant'a
-- sarıldı. Order-create akışındaki katalog snapshot okumaları F3a order-tx
-- withTenant context'ini miras alır (resolveItemSnapshots/resolveItemAttributes).
-- (tenant_id, ...) index prefix'leri korunur → RLS policy leading-column uyumu.
--
-- Politika fail-closed: context set edilmezse (boş/unset) hiçbir satır görünmez.
-- `current_setting('app.current_tenant_id', true)` değeri F1 `withTenant`
-- wrapper'ı tarafından her transaction'ın ilk statement'inde `set_config(..., true)`
-- (is_local) ile enjekte edilir → F1 withTenant.ts + migration 054-058 ile birebir.
--
-- Forward-only (ADR-003 §15). Idempotent (ADR-003 §16) — up→up güvenli tekrar.
-- DOWN migration YOK (ev-deseni; runner yalnız `node-pg-migrate up` koşar).
-- ACİL ROLLBACK (prod'da RLS incident'i): operatör manuel çalıştırır —
--   ALTER TABLE public.attribute_options       NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.attribute_options       DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.attribute_groups        NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.attribute_groups        DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.category_attribute_groups NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.category_attribute_groups DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.categories              NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.categories              DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.product_attribute_groups NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.product_attribute_groups DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.product_variants        NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.product_variants        DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.products                NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.products                DISABLE ROW LEVEL SECURITY;
-- (migrator BYPASSRLS geri ALINMAZ; diğer RLS'li tablolar açık kalır.)

-- ⚠️ ÖN-KOŞUL — SUPERUSER, MIGRATION DIŞI (§13.5 bootstrap):
-- migrator zaten BYPASSRLS (F2'de deploy.md §6.1'e taşındı, prod'da bir kez
-- koşuldu, KALICI). F4b ek superuser adımı GEREKTİRMEZ. DDL tablo sahibi
-- migrator ile koşar. `app_tenant` (runtime) NOBYPASSRLS → RLS'e tabidir.

-- === products ===
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
-- FORCE: tablo sahibi/app rolü bile bypass edemez (yalnız ENABLE yetmez).
ALTER TABLE public.products FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS products_tenant_isolation ON public.products;
CREATE POLICY products_tenant_isolation ON public.products
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- === product_variants ===
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_variants_tenant_isolation ON public.product_variants;
CREATE POLICY product_variants_tenant_isolation ON public.product_variants
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- === product_attribute_groups ===
ALTER TABLE public.product_attribute_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_attribute_groups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_attribute_groups_tenant_isolation ON public.product_attribute_groups;
CREATE POLICY product_attribute_groups_tenant_isolation ON public.product_attribute_groups
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- === categories ===
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS categories_tenant_isolation ON public.categories;
CREATE POLICY categories_tenant_isolation ON public.categories
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- === category_attribute_groups ===
ALTER TABLE public.category_attribute_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_attribute_groups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS category_attribute_groups_tenant_isolation ON public.category_attribute_groups;
CREATE POLICY category_attribute_groups_tenant_isolation ON public.category_attribute_groups
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- === attribute_groups ===
ALTER TABLE public.attribute_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attribute_groups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attribute_groups_tenant_isolation ON public.attribute_groups;
CREATE POLICY attribute_groups_tenant_isolation ON public.attribute_groups
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- === attribute_options ===
ALTER TABLE public.attribute_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attribute_options FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attribute_options_tenant_isolation ON public.attribute_options;
CREATE POLICY attribute_options_tenant_isolation ON public.attribute_options
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
