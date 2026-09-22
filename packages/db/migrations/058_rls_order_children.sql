-- 058_rls_order_children.sql
-- ADR-041 (Tenant İzolasyon — Defense-in-Depth) Faz 4a — order-family children + call_logs.
--
-- Katman 1 (birincil GÜVENLİK garantisi): Postgres Row-Level Security.
-- Kapsam (ADR-041 Amendment 2 F4a + Amendment 3 F4a-kapsam-revizyonu):
--   • order_item_attributes  (sipariş kalemi özellik snapshot'ı)
--   • order_item_batches     (kalem gönderim partisi)
--   • order_no_counters      (tenant+iş-günü sipariş no sayacı)
--   • call_logs              (Caller ID — KVKK PII; ADR-040 pii.ts)
--
-- ⚠️ audit_logs BU MİGRASYONDA YOK — Amendment 3 F4a-kapsam-revizyonunda ERTELENDİ.
--    Gerekçe: `writeAudit` çapraz-kesen (her domain yazıyor, çoğu context'siz) →
--    RLS canlı işlemleri kırardı. audit_logs, tüm writeAudit-çağıran domain'ler
--    (F4b menu + F4c customers + F4d) withTenant'a sarıldıktan SONRA ayrı fazda
--    açılır (§13.5 policy + cron_purger tasarımı ADR-041 Amd3'te hazır bekler).
--
-- order-family (order_item_attributes/batches/no_counters) consumer'ları F3a
-- order-tx'inde ZATEN withTenant-context'li (executor-agnostik repo mirası) →
-- ek kod sarımı gerekmez; kapsam negatif-kontrolle kanıtlanır.
-- call_logs consumer'ları (caller-id route + pending-caller-replay + ttl-cleanup
-- purgeCallLogs) bu PR'da withTenant'a sarılır.
--
-- Politika fail-closed: context set edilmezse (boş/unset) hiçbir satır görünmez.
-- `current_setting('app.current_tenant_id', true)` değeri F1 `withTenant`
-- wrapper'ı tarafından her transaction'ın ilk statement'inde `set_config(..., true)`
-- (is_local) ile enjekte edilir → F1 withTenant.ts + migration 054-057 ile birebir.
--
-- Forward-only (ADR-003 §15). Idempotent (ADR-003 §16) — up→up güvenli tekrar.
-- DOWN migration YOK (ev-deseni; runner yalnız `node-pg-migrate up` koşar).
-- ACİL ROLLBACK (prod'da RLS incident'i): operatör manuel çalıştırır —
--   ALTER TABLE public.call_logs             NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.call_logs             DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.order_no_counters     NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.order_no_counters     DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.order_item_batches    NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.order_item_batches    DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.order_item_attributes NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.order_item_attributes DISABLE ROW LEVEL SECURITY;
-- (migrator BYPASSRLS geri ALINMAZ; diğer RLS'li tablolar açık kalır.)

-- ⚠️ ÖN-KOŞUL — SUPERUSER, MIGRATION DIŞI (§13.5 bootstrap):
--   ALTER ROLE migrator BYPASSRLS;
-- F2'de (migration 054) `deploy.md §6.1`'e taşındı ve prod'da BİR KEZ koşuldu;
-- KALICI olduğu için F4a ek superuser adımı GEREKTİRMEZ (migrator zaten BYPASSRLS).
-- Aşağıdaki DDL tablo sahibi migrator ile koşar (sahiplik yeter). `app_tenant`
-- (runtime API rolü) NOBYPASSRLS kalır → RLS'e tabidir (izolasyonun uygulayıcısı).

-- === order_item_attributes ===
ALTER TABLE public.order_item_attributes ENABLE ROW LEVEL SECURITY;
-- FORCE: tablo sahibi/app rolü bile bypass edemez (yalnız ENABLE yetmez).
ALTER TABLE public.order_item_attributes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_item_attributes_tenant_isolation ON public.order_item_attributes;
CREATE POLICY order_item_attributes_tenant_isolation ON public.order_item_attributes
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- === order_item_batches ===
ALTER TABLE public.order_item_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_item_batches_tenant_isolation ON public.order_item_batches;
CREATE POLICY order_item_batches_tenant_isolation ON public.order_item_batches
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- === order_no_counters ===
ALTER TABLE public.order_no_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_no_counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_no_counters_tenant_isolation ON public.order_no_counters;
CREATE POLICY order_no_counters_tenant_isolation ON public.order_no_counters
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- === call_logs ===
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_logs_tenant_isolation ON public.call_logs;
CREATE POLICY call_logs_tenant_isolation ON public.call_logs
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
