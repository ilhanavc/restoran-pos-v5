-- 063_rls_audit_logs.sql
-- ADR-041 (Tenant İzolasyon — Defense-in-Depth) SON DATA-FAZI.
-- ADR-041 Amendment 5 (S134, 2026-09-29).
--
-- Katman 1 (birincil GÜVENLİK garantisi): Postgres Row-Level Security.
-- Kapsam:
--   • audit_logs  (denetim günlüğü — ADR-002 §12, ADR-037 ekranı)
--
-- Bu tabloyla 23 tablo force-RLS altına girer ve RLS kampanyasının
-- **data-fazları BİTER**. Kalan yalnız F4e: agents · users · refresh_tokens
-- (auth/pre-context sınıfı, login-resolution ADR'sine bağlı).
--
-- ⚠️ NEDEN EN SONA BIRAKILDI: `writeAudit` **çapraz-kesen** — her mutasyon
-- domain'i audit yazar. Faz S128'de bu yüzden ertelendi ("çoğu context'siz").
-- S134 envanteri: **71 çağrının 53'ü zaten `withTenant` altında** (F3a/F4b/F4c
-- fazlarının yan faydası); kalan 18'i bu PR'da sarıldı + 3 cron çağrısı
-- cron_purger'a geçti.
--
-- ⚠️ Bu PR'da withTenant'a SARILANLAR (16 sarım):
--   Yazma — `deps.db` ile koşanlar (mutasyon zaten sarılıydı, audit değildi):
--     • routes/customers/index.ts ×9 (:701 :765 :830 :1041 :1216 :1275 :1321
--       :1397 :1465) — müşteri CRUD + telefon/adres + export
--     • utils/csv-format-handler.ts:210 — TÜM rapor CSV'lerinin ortak yolu
--       (tek satır, geniş blast radius: audit ÖNCE, send SONRA)
--   Yazma — `trx` alıyor ama tx **düz `.transaction()`** ile açılmış (yüzeysel
--   taramada "sarılı" görünürler; `set_config` YOK — envanterin en sinsi sınıfı):
--     • routes/users.ts ×4 (:143 :267 :355 :458) — blok 132/235/327/449
--     • routes/printers.ts:405 — blok :386-420
--   Okuma:
--     • routes/audit-logs.ts:233 — `createAuditLogsRepository(deps.db)`
--       (+ CSV yolu :272 :280 :294-313)
-- Miras yoluyla zaten context altında olanlar (sarım GEREKMEDİ, 53 site):
--   orders ×17 · payments ×4 · customers ×4 · menu ×4 · areas ×4 · tables ×4 ·
--   products ×3 · settings ×1 · attribute servisleri ×10 · AreaService ×1 ·
--   printers.ts:544 (withTenant bloğu :457-562 İÇİNDE — 386'daki düz tx
--   :420'de kapanıyor; brace-eşlemesiyle doğrulandı, ilk envanter turunda
--   yanlış sınıflandırılmıştı).
--
-- ⚠️ cron_purger BURADA GERÇEKTEN GEREKLİ (F4d-2'nin aksine — Amd4 K1):
--   `audit_logs`'un İKİ silme pass'i ve self-audit'i `tenant_id IS NULL`
--   üzerinde çalışır (cron/ttl-cleanup.ts :245 per-tenant · :274 NULL pass ·
--   :295/:378/:456 self-audit). NULL-tenant INSERT/DELETE `withTenant` ile
--   ÇÖZÜLEMEZ (helper geçersiz UUID'de tx'i hiç açmaz, fail-closed).
--   → Prod ÖN-KOŞUL (K7): `ALTER ROLE cron_purger LOGIN PASSWORD '<vault>'
--     CONNECTION LIMIT 2;` + `CRON_DATABASE_URL` env'i. Bu migration'dan ÖNCE.
--
-- ⚠️ RİSK PROFİLİ — İKİ FARKLI KIRILMA (Amd5 risk bölümü):
--   (A) GÜRÜLTÜLÜ (baskın): context'siz INSERT `WITH CHECK` ihlali fırlatır →
--       HTTP **500**. Müşteri CRUD / kullanıcı yönetimi / yazıcı ayarı / tüm
--       rapor CSV'leri **anında durur**. Sessiz veri kaybı YOK: audit INSERT'i
--       mutasyonla aynı tx'te → 500 = tam rollback, yarım kayıt kalmaz.
--       Teşhis kolay (Sentry 500 + `row-level security`), ama canlı kesinti
--       riski yüksek → **YOĞUN SAAT DIŞI ŞART**.
--   (B) SESSİZ (dört yol, 500 VERMEZ — bunlar için yeşil test kanıt DEĞİL):
--       • customers/index.ts:1041 `customer.history_viewed` — audit yanıt
--         gönderildikten SONRA, try/catch içinde → **KVKK m.12 PII-okuma izi**
--         sessizce kaybolur (en sinsi: "erişim izi tutuluyor" iddiasını boşa
--         çıkarır).
--       • cron self-audit ×3 — try/catch + logger.error → `audit.purge` izi yok.
--       • routes/audit-logs.ts okuma — 0 satır + HTTP **200** → denetim ekranı
--         BOŞ görünür, hata yok.
--   Kapsamın kanıtı negatif kontroldür (Amd5 K6): sarım sökülünce ilgili
--   app_tenant testi kırmızıya dönmeli. ⚠️ `users.test.ts` ve
--   `audit-logs.test.ts` süperuser altındaydı → app_tenant'a geçirildi
--   (süperuser RLS'e TABİ DEĞİL, FORCE bile etkilemez → sahte-yeşil).
--
-- ⚠️ `app_admin` POLICY'Sİ YAZILMADI (Amd5 K1 — Amd3 Karar 3 revize):
--   Amd3 `system_select_audit_admin ... TO app_admin` öngörüyordu. İki
--   doğrulanmış gerekçeyle çıkarıldı: (a) `app_admin` rolü var (000_init:28,
--   prod'da da) ama **NOLOGIN**; uygulama YALNIZ app_tenant ile bağlanır
--   (prod: app_tenant login=t, app_admin login=f) → policy hiç devreye
--   girmezdi, ölü kod olurdu. (b) Amd3'ün korumak istediği şey app katmanında
--   ZATEN var: repositories/audit-logs.ts:82 `.where('al.tenant_id','=',tid)`
--   → prod'daki 11.478 satırın 255'i NULL-tenant ve denetim ekranında
--   HÂLİHAZIRDA görünmüyor. Yani policy'nin NULL'ı dışlaması bir davranış
--   değişikliği DEĞİL. Sistem-actor satırlarını okuma ihtiyacı doğarsa F4e.
--
-- ⚠️ SENTRY: mevcut RLS-regresyon alarmı (A) sınıfını YAKALAR (500 +
-- `new row violates row-level security policy`). (B) sınıfını yakalamaz →
-- yeni alarm koşulu: bir gecede ÜÇ `audit.purge` event'inden hiçbirinin
-- yazılmaması (cron'un tamamen ölmesi bugün sessiz).
--
-- Mevcut index'lere DOKUNULMAZ: tüm okuma yolları `(tenant_id, ...)` önden
-- yüklemli (repo JSDoc :9-11) → policy aynı kolondan çözülür.
--
-- Politika fail-closed: context set edilmezse hiçbir satır görünmez/yazılamaz.
-- `set_config('app.current_tenant_id', …, true)` (is_local) F1 withTenant
-- wrapper'ı tarafından her tx'in ilk statement'inde enjekte edilir → 054-062
-- ile birebir.
--
-- Forward-only (ADR-003 §15). Idempotent (ADR-003 §16) — up→up güvenli tekrar.
-- DOWN migration YOK (ev-deseni; runner yalnız `node-pg-migrate up` koşar).
-- ACİL ROLLBACK (prod'da 500 dalgası): operatör manuel çalıştırır —
--   ALTER TABLE public.audit_logs NO FORCE ROW LEVEL SECURITY; ALTER TABLE public.audit_logs DISABLE ROW LEVEL SECURITY;
-- (migrator BYPASSRLS ve cron_purger GRANT'i geri ALINMAZ; zararsız.)
-- ⚠️ Rollback sonrası her şey çalışmaya DEVAM eder — yeni kodun withTenant
-- sarımları RLS kapalıyken zararsızdır (okunmayan bir GUC set eder) ve
-- cron_purger pool'u BYPASSRLS olduğu için RLS'siz tabloda da doğru çalışır.

-- ⚠️ DEPLOY SIRASI — F4 reçetesinden BİLİNÇLİ SAPMA (Amd5 K7):
-- Normal sıra "kod ÖNCE, RLS SONRA"dır. Bu fazda **rol adımı en BAŞA** eklenir:
--   (1) superuser: ALTER ROLE cron_purger LOGIN PASSWORD '<vault>' CONNECTION LIMIT 2;
--   (2) CRON_DATABASE_URL API env'ine eklenir
--   (3) kod deploy + pm2 restart → **M5 assertion geçmeli** (cron pool BYPASSRLS mi)
--   (4) bu migration (063)
--   (5) doğrulama + canlı smoke
-- Gerekçe: K2 gereği yeni kod, env olmadan prod'da AÇILMAZ (fail-fast) →
-- rol + env adımı koddan önce olmak ZORUNDA.
--
-- ⚠️ ÖN-KOŞUL — SUPERUSER: migrator BYPASSRLS zaten kalıcı (F2, deploy.md §6.1).
-- Bu migration ek DDL-superuser adımı gerektirmez; ama cron_purger LOGIN adımı
-- (yukarıda (1)) superuser gerektirir ve migration DIŞINDA koşar.

-- === audit_logs ===
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
-- FORCE: tablo sahibi/app rolü bile bypass edemez (yalnız ENABLE yetmez).
-- Not: BYPASSRLS rol FORCE'u da aşar — cron_purger'ın NULL yazımı bu sayede.
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
-- ⚠️ KOMUT-SPESİFİK POLICY — diğer 22 tablonun generic şablonundan BİLİNÇLİ
-- SAPMA (S134 test bulgusu). Generic `CREATE POLICY … USING …` komut
-- belirtmediğinde **FOR ALL** olur, yani `USING` yüklemi DELETE ve UPDATE'i de
-- kapsar → app_tenant KENDİ tenant'ının denetim satırını SİLEBİLİR/DEĞİŞTİREBİLİR.
-- Bu, `audit_logs`'un varlık sebebine aykırıdır: ele geçirilmiş bir oturum
-- izleri temizleyebilmemeli. Amd3 Karar 3'ün özgün tasarımı bu yüzden
-- komut-spesifikti; Amd5 K1 `app_admin` policy'sini çıkarırken generic'e
-- dönülmüş ve DELETE koruması yanlışlıkla kaybolmuştu. İzolasyon testi
-- ("app_tenant DELETE YAPAMAZ") bunu yakaladı → policy ikiye bölündü.
DROP POLICY IF EXISTS audit_logs_tenant_isolation ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_tenant_select ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_tenant_insert ON public.audit_logs;

-- (1) SELECT: yalnız kendi tenant satırları. Sistem-actor (NULL) satırları
--     eşitlik yüklemi gereği GÖRÜNMEZ — bu bir davranış değişikliği DEĞİL:
--     repositories/audit-logs.ts:82 zaten `.where('tenant_id','=',tid)` ile
--     onları dışlıyordu (Amd5 K1 gerekçesi).
CREATE POLICY audit_logs_tenant_select ON public.audit_logs
  FOR SELECT
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- (2) INSERT: yalnız kendi tenant; **NULL YAZAMAZ**. Bu koşul cron'un
--     self-audit'ini app pool'uyla yazmayı imkânsız kılar — K2 (env fail-fast)
--     ve K3 (M5 assertion) tam olarak bu yüzden var.
CREATE POLICY audit_logs_tenant_insert ON public.audit_logs
  FOR INSERT
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid
              AND tenant_id IS NOT NULL);

-- (3) UPDATE / DELETE policy YOK → app_tenant denetim izini **değiştiremez ve
--     silemez** (fail-closed: hata değil, sessiz 0 satır). Silme yalnız
--     BYPASSRLS (`cron_purger`) ile, yani yalnız retention cron'u.
--     Uygulamada audit_logs'a UPDATE/DELETE yapan kod yolu ZATEN yok
--     (envanter: yalnız cron siler) — bu policy o sınırı DB'de kilitler.

-- cron_purger self-audit NULL INSERT için ŞART (Amd3 S128 düzeltmesi).
-- ⚠️ Doğrulandı: prod'da cron_purger audit_logs yetkileri S:t I:**f** D:t —
-- 000_init.sql:484 yalnız SELECT,DELETE veriyor. BYPASSRLS policy'yi atlar,
-- tablo GRANT'ini ATLAMAZ → bu satır olmadan self-audit 42501 verir.
GRANT INSERT ON public.audit_logs TO cron_purger;

-- ⚠️ İKİNCİ EKSİK GRANT (S134 implementasyon bulgusu — ADR'de ÖNGÖRÜLMEMİŞTİ).
-- Cron, üç retention task'ının HEPSİNDE ilk iş olarak `listTenantIds`
-- (cron/ttl-cleanup.ts:211) ile `tenants` tablosunu okur. cron_purger'ın
-- `tenants` üzerinde SELECT yetkisi YOKTU (ampirik: has_table_privilege →
-- false; 000_init.sql:484 whitelist'i yalnız audit_logs/call_logs/print_jobs).
-- Bu GRANT olmadan cron pool'a geçiş **42501 permission denied** verir ve
-- audit_logs + call_logs + print_jobs retention'ının ÜÇÜ BİRDEN çöker —
-- üstelik task'lar try/catch'li olduğu için SESSİZCE (yalnız logger.error).
-- Amd3'ün GRANT INSERT tespitinin aynı sınıfı: BYPASSRLS policy'yi atlar,
-- tablo GRANT'ini ATLAMAZ.
-- Yüzey değerlendirmesi: `tenants` (id/slug/timezone/deleted_at) PII taşımaz
-- ve cron zaten tüm tenant'ların audit/çağrı/baskı kaydını silebiliyor →
-- tenant listesini okumak ek bypass yüzeyi açmaz, zorunlu bir ön-koşuldur.
GRANT SELECT ON public.tenants TO cron_purger;
