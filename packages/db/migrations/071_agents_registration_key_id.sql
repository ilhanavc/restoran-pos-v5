-- 071_agents_registration_key_id.sql
--
-- ADR-044 K2 — `agents` satırı artık "hangi KAYIT ANAHTARI ile kaydoldum"
-- sorusuna doğrudan cevap verir. PR-2 (K1 + K2).
--
-- NEDEN: rotasyonun kabul kanıtı budur. Dalga D'de üç servisin env'i elle
-- güncellenir ve "üçü de yeni anahtarla yeniden kaydoldu mu?" sorusunun tek
-- doğrudan cevabı bu kolondur — 200/204 yanıtı kanıt DEĞİLDİR
-- ([[feedback_failclosed_auth_proof_via_touch_column]] sınıfı: yalnız başarılı
-- doğrulamadan SONRA yazılan kolon doğrudan kanıttır). Bu yüzden register'ın
-- **idempotent** yolu da bu kolonu GÜNCELLER (ADR-044 K2'nin açık kararı);
-- aksi hâlde kolon ilk kayıttan sonra sonsuza dek bayat kalırdı.
--
-- ⚠️ `api_key_hash` DOKUNULMAZ: NOT NULL kalır, backfill YOK, DROP YOK
-- (ADR-044 K8 kapsam kilidi). Artık legacy `pk_` dalının doğrulama kaynağı ve
-- forensik alandır; `agent_version` (mig 069) de aynen kalır.
--
-- ⚠️ NUMARA NOTU: ADR gövdesi bu kolonu "mig 070" diyor; fiilî numara **071**
-- (kayıt: ADR-044 "Uygulama notları — PR-1" maddesi 1). Head 070'ti
-- (`070_create_agent_registration_keys.sql`, aynı PR) — repo + pos_test'ten
-- sayıldı, dokümandan kopyalanmadı ([[feedback_adr_prewritten_inventory_restale]]).
--
-- 🔴 SIRA BAĞLAYICI: 070 (keys tablosu) BU dosyadan ÖNCE koşmalı — FK hedefi
-- orada yaratılıyor. node-pg-migrate numarasal sırayı garanti eder.
--
-- Forward-only (ADR-003 §15). Idempotent (ADR-003 §16). DOWN migration YOK.
--
-- 🔴 ACİL ROLLBACK (operatör manuel):
--   ALTER TABLE public.agents DROP COLUMN IF EXISTS registration_key_id;
-- ⚠️ **SIRA: bu kolon 070'in tablosundan ÖNCE düşer** (FK bağımlılığı; ters
-- sırada `DROP TABLE agent_registration_keys` 2BP01 verir).
-- ⚠️ Ama önce KOD: `print-jobs.ts` register'ın v2 dalı bu kolonu `await`'li
-- INSERT/UPDATE'te yazıyor → kolon yoksa `42703` → `POST /agent/register`
-- **500** ve yeniden boot eden ajan kaydolamaz (mig 069'un aynı bulgusu).
-- Doğru sıra: (1) API'yi önceki sürüme al → (2) ancak sonra kolonu düşür.
-- Daha iyisi: **kolonu BIRAK** — nullable, okunmazsa zararsız.
--
-- 🔒 KİLİT PROFİLİ: nullable + DEFAULT YOK → Postgres 11+ tablo yeniden yazımı
-- yapmaz, `ALTER` yalnız katalog günceller (ms'ler). ⚠️ Risk ALTER'ın SÜRESİ
-- DEĞİL, KUYUKLANMA: `agents` sıcak yolda (her poll `last_seen_at` yazıyor);
-- açık bir transaction varsa bekleyen AccessExclusive'in ARKASINA her agent
-- sorgusu dizilir → poll bloke olur → baskı durur. 3 sn'de kilidi alamazsa
-- migration patlar ve bu DOĞRU davranıştır (069:52-60 · 064:181-187).
-- ⚠️ **BU DEPLOY'DA KİLİT 071'DE DEĞİL, 069'DA ALINIR** (gate bulgusu,
-- 2026-11-07): prod `75ca305`, yani **069'un gerisinde**; deploy
-- `069 + 070 + 071`'i node-pg-migrate'in `singleTransaction` varsayılanıyla
-- TEK transaction'da koşar. `agents` üzerindeki AccessExclusive **069:63'te**
-- alınır ve COMMIT'e kadar tutulur → buradaki `lock_timeout` o kilit için
-- fiilen **no-op**'tur, gerçek sigorta `069:61`'dir. Satır yine de duruyor:
-- 071 ileride tek başına koşarsa (ör. yeniden kurulum) koruma orada olmalı.
--
-- 📋 **INDEX GATE KAYDI** (`docs/ops/deploy.md:108-109`, ADR-031 K12 Amd —
-- canlı-veri tablosunda her index PR'ı manuel gate + hedef satır sayısı ister):
-- `agents` prod'da **5 satır** (ADR-044 ölçümü, 2026-11-05), 500K eşiğinin çok
-- altında ve index tamamı-NULL bir kolonda kuruluyor → kilit saniye-altı.
-- db-migration-guard 2026-11-07'de **onayladı**: off-hours penceresi gerekmez.
-- Kapalı-restoran penceresi ŞART DEĞİL.
--
-- 🔑 RLS/GRANT GEREKMİYOR: `agents` mig 064'te force-RLS altına girdi ve
-- `app_tenant` GRANT'leri TABLO seviyesindedir (kolon seviyesinde değil) → yeni
-- kolon mevcut yetkiye otomatik dâhildir. ⚠️ FK hedefi
-- (`agent_registration_keys`) ayrı bir tablodur ve FK doğrulaması **referans
-- bütünlüğü** kontrolüdür: Postgres bunu RLS'e tabi tutmaz (policy FK
-- kontrolünü filtrelemez), ayrıca `app_tenant`'ın hedef tabloda SELECT
-- GRANT'i mig 070'te zaten verildi → INSERT sırasında 42501 riski YOK.

SET LOCAL lock_timeout = '3s';

-- 🔑 **BİLEŞİK FK — tenant-ötesi işaret şemada imkânsız** (db-migration-guard
-- gate'i, 2026-11-07). Tek-kolonlu FK, tenant A'nın ajan satırının tenant B'nin
-- anahtar satırını işaret etmesini **engellemez**: FK doğrulaması RLS'e tabi
-- değildir. Bugün erişilemez bir durum (aday sorgusu `withTenant` içinde), ama
-- güvence yalnız uygulama kodunun doğru davranmasına dayanıyordu —
-- [[feedback_negative_guarantee_stays_green]] sınıfı. `(tenant_id,
-- registration_key_id)` bileşik FK'si kuralı **pozitif** olarak kurar.
--
-- ⚠️ `ON DELETE SET NULL (registration_key_id)` — **kolon listesi ŞART**.
-- Listesiz hâli referans eden kolonların HEPSİNİ NULL'a çekmeye çalışır ve
-- `agents.tenant_id` NOT NULL olduğu için silme **hata verirdi**. Kolon listeli
-- SET NULL PostgreSQL 15+ özelliğidir; prod PG17 (doğrulandı).
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS registration_key_id UUID NULL;

ALTER TABLE public.agents
  DROP CONSTRAINT IF EXISTS agents_registration_key_fk;

ALTER TABLE public.agents
  ADD CONSTRAINT agents_registration_key_fk
    FOREIGN KEY (tenant_id, registration_key_id)
    REFERENCES public.agent_registration_keys (tenant_id, id)
    ON DELETE SET NULL (registration_key_id);

-- 🔑 FK'de otomatik index YOK (Postgres yalnız PK/UNIQUE için index yaratır).
-- İndeks, keys satırı silinirse/anahtar id'siyle "bu anahtarla kaç cihaz
-- kaydoldu" sorulursa (Dalga D kabul kanıtı) seq scan'i önler. VERI-4 politikası.
CREATE INDEX IF NOT EXISTS agents_registration_key_id_idx
  ON public.agents (registration_key_id);

-- COMMENT kysely-codegen'in JSDoc kaynağıdır ([[feedback_codegen_jsdoc_from_comment]]).
COMMENT ON COLUMN public.agents.registration_key_id IS
  'ADR-044 K2: bu cihazın SON başarılı register''ında doğrulanan agent_registration_keys satırı. Yalnız v2 (pk2_) dalı yazar; legacy (pk_) dalında NULL KALIR — o dalın davranışı bit-bit değişmez (ADR-044 K1.10). İdempotent re-register de GÜNCELLER: rotasyonun kabul kanıtı "üç satırın üçünde YENİ anahtar id''si" okumasıdır, 200 yanıtı kanıt değildir. ON DELETE SET NULL — anahtar satırı düşse bile ajan satırı ve baskı yolu ayakta kalır.';

RESET lock_timeout;
