-- 061_rls_tenant_settings.sql
-- ADR-041 (Tenant İzolasyon — Defense-in-Depth) Faz 4d — infra/config, 1/2.
--
-- Katman 1 (birincil GÜVENLİK garantisi): Postgres Row-Level Security.
-- Kapsam (ADR-041 Amendment 2 F4d, Karar 2 "DAHİL ama özel wiring"):
--   • tenant_settings  (tenant başına TEK satır: timezone, caller-ID istasyonu)
--
-- Bu tablo `tenant_id PRIMARY KEY` taşır (ADR-003 §4.3 singleton-per-tenant) —
-- diğer RLS'li tablolardaki `id UUID PK + tenant_id` kalıbından farklı, ama
-- politika aynı kolona baktığı için şablon birebir uygulanır.
--
-- ⚠️ ÖZEL WIRING — ADR-041 Amd2 Karar 2'nin öngördüğü iki pre-context yolu:
--   (1) DB TRIGGER `populate_order_store_date` (028_fix_...sql) order INSERT
--       sırasında `SELECT timezone FROM tenant_settings` yapar. SECURITY DEFINER
--       DEĞİL → çağıranın rolü + çağıranın RLS context'iyle koşar. Order INSERT
--       zaten F3a'da withTenant altına alındığı için `app.current_tenant_id`
--       set → trigger satırı GÖRÜR. Sarım GEREKMEDİ (Karar 2 "trigger uyumlu").
--       ⚠️ Ters yönde bir garanti de doğar: context'siz bir order INSERT artık
--       trigger'ın `RAISE EXCEPTION 'tenant_settings missing'` yolundan döner —
--       yanıltıcı mesaj, ama orders RLS'i o insert'i zaten WITH CHECK ile keser.
--   (2) BOOTSTRAP: scripts/bootstrap-prod.ts + packages/db/src/seed.ts INSERT'leri
--       migrator/superuser bağlantısıyla koşar (BYPASSRLS) → etkilenmez.
--
-- ⚠️ Bu PR'da withTenant'a sarılanlar (envanter, iki-kök: apps/api + packages/db):
--   • routes/settings.ts GET (top-level db) + PATCH (kendi tx'i — own-tx escapee,
--     F3c bulkDelete sınıfı)
--   • index.ts callerStationLookup (Socket.IO handshake, tx yok)
--   • routes/orders.ts liste default store_date penceresi (tx dışı)
--   • routes/reports/tz.ts resolveTenantTimezone — sarım HELPER'IN İÇİNE gömüldü
--     (18 çağrı call-site'ı değişmedi; yeni rapor endpoint'i sarımı unutamaz)
--   • utils/tenant-info.ts getTenantInfo — aynı desen (19 çağrı, CSV export yolu)
-- Miras yoluyla zaten context altında olanlar (sarım GEREKMEDİ): print/enqueue-
-- {kitchen,bill,cancel,packing}-job.ts timezone okumaları (order-tx), repositories/
-- orders.ts (3 yer) + repositories/payments.ts day-guard join'i (F3a/F3c),
-- routes/caller-id/index.ts:262 (F4a'da sarıldı).
--
-- ⚠️ SESSİZ-BOZULMA SINIFI (bu fazın en riskli yanı): tz.ts ve tenant-info.ts
-- satır bulamazsa `?? 'Europe/Istanbul'` defansif default'una düşer — HATA
-- FIRLATMAZ. Yani eksik bir sarım 500 vermez, yalnız rapor gün pencerelerini
-- sessizce yanlış hesaplar. Bu yüzden kapsamın kanıtı negatif-kontrol testidir
-- (sarımı sök → app_tenant testi kırmızı), yeşil test değil.
--
-- Mevcut index'lere DOKUNULMAZ: `tenant_id` zaten PK → politika PK üzerinden
-- çözülür, ek index gereksiz.
--
-- Politika fail-closed: context set edilmezse (boş/unset) hiçbir satır görünmez.
-- `current_setting('app.current_tenant_id', true)` değeri F1 `withTenant`
-- wrapper'ı tarafından her transaction'ın ilk statement'inde `set_config(..., true)`
-- (is_local) ile enjekte edilir → F1 withTenant.ts + migration 054-060 ile birebir.
--
-- Forward-only (ADR-003 §15). Idempotent (ADR-003 §16) — up→up güvenli tekrar.
-- DOWN migration YOK (ev-deseni; runner yalnız `node-pg-migrate up` koşar).
-- ACİL ROLLBACK (prod'da RLS incident'i): operatör manuel çalıştırır —
--   ALTER TABLE public.tenant_settings NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.tenant_settings DISABLE ROW LEVEL SECURITY;
-- (migrator BYPASSRLS geri ALINMAZ; diğer RLS'li tablolar açık kalır.)
-- ⚠️ Rollback sonrası /settings ve raporlar çalışmaya DEVAM eder — yeni kodun
-- withTenant sarımları RLS kapalıyken zararsızdır (okunmayan bir GUC set eder).

-- ⚠️ ÖN-KOŞUL — SUPERUSER, MIGRATION DIŞI (§13.5 bootstrap):
-- migrator zaten BYPASSRLS (F2'de deploy.md §6.1'e taşındı, prod'da bir kez
-- koşuldu, KALICI). F4d ek superuser adımı GEREKTİRMEZ. DDL tablo sahibi
-- migrator ile koşar. `app_tenant` (runtime) NOBYPASSRLS → RLS'e tabidir.
-- app_tenant DML yetkisi prod'da doğrulandı (S130 pre-flight: S/I/U/D = t|t|t|t).

-- === tenant_settings ===
ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;
-- FORCE: tablo sahibi/app rolü bile bypass edemez (yalnız ENABLE yetmez).
ALTER TABLE public.tenant_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_settings_tenant_isolation ON public.tenant_settings;
CREATE POLICY tenant_settings_tenant_isolation ON public.tenant_settings
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
