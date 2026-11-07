-- 070_create_agent_registration_keys.sql
--
-- ADR-044 K2 — kayıt sırrı `agents` satırlarından AYRILIR, kendi tablosuna
-- taşınır. PR-2 (K1 + K2), `security-reviewer` imzası şart.
--
-- NEDEN: `agents.api_key_hash` bugün iki ayrı soruyu aynı kolonda taşıyor —
-- *"bu cihaz hangi anahtarla kaydoldu"* (gözlem) ve *"şu an hangi anahtarlar
-- kayıt için geçerli"* (yetki). İkisi aynı kolonda olduğu sürece bir `agents`
-- satırını iptal etmek anahtarı iptal ETMEZ (prod ölçümü: 5 ajan / 2 hash,
-- dördü aynı hash — 4 Temmuz'da iptal edilmiş satır hâlâ geçerli bir kayıt
-- sırrı taşıyor) ve rotasyon imkânsızdır. Bu tablo yetki sorusunu devralır;
-- `api_key_hash` DOKUNULMAZ (legacy `pk_` dalının doğrulama kaynağı + forensik).
--
-- ⚠️ NUMARA NOTU: ADR-044 gövdesi "069 = keys tablosu, 070 = agents kolonları"
-- diyor; PR sırası bunu kaydırdı ve kayıt ADR'nin "Uygulama notları — PR-1"
-- maddesi 1'dedir. Fiilî numaralar: `069_agents_agent_version.sql` (PR-1, head)
-- → **070 = bu dosya (keys tablosu)** → **071 = `agents.registration_key_id`**.
-- [[feedback_adr_prewritten_inventory_restale]] — head koddan yeniden sayıldı
-- (pos_test + repo: 069).
--
-- Forward-only (ADR-003 §15). Idempotent (ADR-003 §16) — up→up güvenli tekrar.
-- DOWN migration YOK (ev-deseni; runner yalnız `node-pg-migrate up` koşar).
--
-- 🔴 ACİL ROLLBACK (prod'da register 401 dalgası / baskı durursa):
--   -- (1) ÖNCE kod: API'yi 070/071 öncesi sürüme al (legacy `pk_` dalı zaten
--   --     bu tabloyu hiç okumaz → canlı üç yazıcı rollback'siz de akar).
--   -- (2) Sadece RLS şüpheliyse, tabloyu düşürmeden:
--   ALTER TABLE public.agent_registration_keys NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE public.agent_registration_keys DISABLE ROW LEVEL SECURITY;
--   -- (3) Tabloyu düşürmek GEREKİRSE **SIRA BAĞLAYICI**: `agents.registration_key_id`
--   --     (mig 071) bu tabloya FK ile bağlıdır → önce o kolon düşmeli:
--   ALTER TABLE public.agents DROP COLUMN IF EXISTS registration_key_id;
--   DROP TABLE IF EXISTS public.agent_registration_keys;
--   -- Yani: **071'in rollback'i 070'in rollback'inden ÖNCE gelir.** Ters sırada
--   -- `DROP TABLE` 2BP01 (dependent object) verir.
-- ⚠️ Daha iyisi: tabloyu BIRAK. Okunmazsa zararsızdır; forward-only disiplini
-- (ADR-003) de bunu söyler. Düşürmek yalnız şema temizliği için ve API eski
-- sürümdeyken yapılır.
--
-- 🔒 KİLİT PROFİLİ: yeni tablo → mevcut hiçbir satır kilitlenmez, baskı yolu
-- (`print_jobs` claim'i, `agents` poll'u) etkilenmez. Kapalı-restoran penceresi
-- ŞART DEĞİL. `lock_timeout` yine set edilir: 064'ten beri kesintisiz
-- konvansiyon (064 · 065 · 066 · 067 · 068 · 069), desen 069:61/:70. ⚠️ `SET LOCAL`
-- de tx kapsamlıdır ve node-pg-migrate tüm koşumu tek tx'te sürdüğü için
-- SONRAKİ migration'lara sızar → dosya sonunda `RESET` (068:46 dersi).
--
-- 🔑 GRANT ÖN-UÇUŞU (Amd5'in en pahalı dersi — eksik `GRANT SELECT ON tenants`
-- üç retention'ı sessizce çökertecekti; 046 aynı sınıfın ikinci vakası: 045'in
-- yeni tablosunda `app_tenant` GRANT'i unutulmuştu):
--   · `000_init.sql:480` → `ALTER DEFAULT PRIVILEGES … GRANT SELECT, INSERT,
--     UPDATE, DELETE ON TABLES TO app_tenant`. Yani yeni tablo **DELETE dâhil**
--     dört yetkiyi OTOMATİK alabilir (default privileges, tabloyu yaratan rolün
--     kimliğine bağlı). ⚠️ **PROD'DA ETKİLİ OLAN KAYIT BU DEĞİL** (gate
--     bulgusu, 2026-11-07): `000_init`'inki `FOR ROLE postgres`'tir; migration'ları
--     koşan rol `migrator` ve onun default-ACL'i 2026-07-13'te ayrıca verildi
--     (`docs/ops/deploy.md:277-282`; 045 vakası tam bunu yakalamıştı). Sonuç
--     değişmiyor — aşağıdaki `REVOKE DELETE` **iki yolda da** yük taşır. 🔴 Bu, aşağıdaki "DELETE yok" kararını sessizce
--     bozacaktı → **açık `REVOKE DELETE`** yazılır. [[feedback_negative_guarantee_stays_green]]:
--     "policy yazmazsam kapalı" negatif güvencesine dayanmıyoruz, yetkiyi
--     POZİTİF olarak geri alıyoruz.
--   · GRANT'ler 046 deseninde AÇIKÇA yazılır (default privileges'ın fresh-install
--     vs. incremental farkına güvenilmez).
--   · `cron_purger`: **GRANT YOK, bilinçli.** Bu tablo bir DENETİM İZİDİR
--     (hangi anahtar ne zaman üretildi / süresi bitti / iptal edildi) —
--     retention hattı (`cron/ttl-cleanup.ts`) buraya hiç dokunmaz ve
--     dokunmaMALIdır: satır sayısı tenant başına bir elin parmakları kadardır,
--     silinmesi rotasyon geçmişini yok eder. Yani bu migration **yeni rol /
--     parola / env adımı GEREKTİRMEZ** ve ADR-041 §13.5 A1 bypass yüzeyini
--     BÜYÜTMEZ.
--
-- 🔴 POLICY ŞEKLİ — KOMUT-SPESİFİK, `agents`'ın generic şablonundan BİLİNÇLİ
-- SAPMA. Emsal `063_rls_audit_logs.sql`, gerekçe
-- [[feedback_generic_rls_policy_covers_all_commands]]: komut belirtmeyen
-- `CREATE POLICY` **FOR ALL**'dır ve `USING` yüklemi DELETE/UPDATE'i de kapsar.
-- `agents` MUTABLE bir envanter tablosudur (orada generic doğruydu); bu tablo
-- ise denetim izi taşır → **DELETE policy YAZILMAZ ve DELETE GRANT'i geri
-- ALINIR**: ele geçirilmiş bir app oturumu "hangi anahtar iptal edilmişti"
-- izini silemez. Fail-closed: eksik policy hata değil, sessiz 0 satır.
--   · SELECT  → register'ın v2 dalı aday anahtarları okur
--   · INSERT  → rotasyon script'i yeni satırı ekler
--   · UPDATE  → rotasyon script'i ESKİ satıra `valid_until` / `revoked_at` yazar
--   · DELETE  → YOK (policy de, GRANT da)
--
-- Politika fail-closed: context set edilmezse (boş/unset) hiçbir satır
-- görünmez/yazılamaz. `set_config('app.current_tenant_id', …, true)` (is_local)
-- `withTenant` wrapper'ı tarafından her transaction'ın ilk statement'inde
-- enjekte edilir → mig 054-065 ile birebir.
--
-- ⚠️ KIRILMA PROFİLİ: bu tablonun tek okuyucusu `POST /agent/register`'ın **v2
-- (`pk2_`) dalıdır**. Sarım/GRANT eksikse aday listesi 0 satır döner →
-- "geçerli kayıt anahtarı yok" → **401** → o tenant'ın ajanı kaydolamaz.
-- Canlı restoranın üç yazıcısı legacy `pk_` dalında aktığı için Dalga D'ye
-- kadar ETKİLENMEZ; yani bu migration'ın kırılması gürültülü ama DAR'dır.
-- Kapsamın kanıtı yeşil test DEĞİL, negatif kontroldür (sök → KIRMIZI → geri
-- sar → YEŞİL) + `SELECT current_user = 'app_tenant'`
-- ([[feedback_rls_test_harness_app_tenant_role]], [[feedback_verify_role_switch_with_current_user]]).

SET LOCAL lock_timeout = '3s';

-- === agent_registration_keys ===
-- `id` DEFAULT YOK: uygulama/script `randomUUID()` üretir (repo geneli deseni;
-- `pgcrypto`/`uuid-ossp` eklentisine bağımlılık doğurmaz).
CREATE TABLE IF NOT EXISTS public.agent_registration_keys (
  id                 UUID        PRIMARY KEY,
  tenant_id          UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  key_hash           TEXT        NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 🔑 ACTOR FK'si **SET NULL**, CASCADE DEĞİL ([[feedback_soft_delete_actor_fk_check]]):
  -- rotasyonu yapan admin sonradan silinirse denetim izi SİLİNMEZ, yalnız
  -- "kim" bilgisi NULL'a düşer. CASCADE, kullanıcı silmeyi bir iz-temizleme
  -- aracına çevirirdi.
  created_by_user_id UUID        NULL REFERENCES public.users(id) ON DELETE SET NULL,
  valid_until        TIMESTAMPTZ NULL,
  revoked_at         TIMESTAMPTZ NULL,
  revoke_reason      TEXT        NULL,
  -- 🔑 BİLEŞİK FK'NİN DAYANAĞI (db-migration-guard gate'i, 2026-11-07).
  -- `id` zaten PK, yani bu kısıt tek başına yeni bir tekillik getirmez —
  -- varlık sebebi mig 071'in `(tenant_id, registration_key_id)` bileşik
  -- FK'sinin bir hedefe ihtiyaç duymasıdır. Böylece "tenant A'nın ajanı
  -- tenant B'nin anahtarını işaret edemez" kuralı **şemada** durur.
  -- Önceki hâl tek-kolonlu FK'ydi ve kuralı yalnız uygulama kodunun doğru
  -- davranması taşıyordu ([[feedback_negative_guarantee_stays_green]]:
  -- negatife dayanan güvence sessizce yeşil kalır).
  CONSTRAINT agent_registration_keys_tenant_id_uq UNIQUE (tenant_id, id)
);

-- ⚠️ `created_by_user_id` üzerinde index YOK, bilinçli: tablo tenant başına
-- bir elin parmakları kadar satır tutar ve bu kolonla hiç sorgulanmaz (yalnız
-- denetimde okunur). VERI-4 hijyeni burada ölçülebilir bir kazanç vermez.
-- `updated_at` kolonu da YOK: `valid_until` ve `revoked_at` zaten semantik
-- zaman damgalarıdır, satır başka hiçbir şekilde değişmez.
--
-- Kısmi index: register'ın v2 aday sorgusunun tam yüklemi
-- (`tenant_id = $1 AND revoked_at IS NULL`). İptal edilmiş satırlar index'e
-- hiç girmez → index tenant başına 1-2 satır kalır.
CREATE INDEX IF NOT EXISTS agent_registration_keys_tenant_active_idx
  ON public.agent_registration_keys (tenant_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.agent_registration_keys ENABLE ROW LEVEL SECURITY;
-- FORCE: tablo sahibi/app rolü bile bypass edemez (yalnız ENABLE yetmez).
ALTER TABLE public.agent_registration_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_registration_keys_tenant_select ON public.agent_registration_keys;
DROP POLICY IF EXISTS agent_registration_keys_tenant_insert ON public.agent_registration_keys;
DROP POLICY IF EXISTS agent_registration_keys_tenant_update ON public.agent_registration_keys;

-- (1) SELECT: yalnız kendi tenant satırları (register v2 aday okuması).
CREATE POLICY agent_registration_keys_tenant_select ON public.agent_registration_keys
  FOR SELECT
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- (2) INSERT: yalnız kendi tenant; **NULL tenant YAZAMAZ** (063 deseni).
CREATE POLICY agent_registration_keys_tenant_insert ON public.agent_registration_keys
  FOR INSERT
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid
              AND tenant_id IS NOT NULL);

-- (3) UPDATE: rotasyonun "eski satıra `valid_until`/`revoked_at` yaz" adımı.
--     `WITH CHECK` de aynı yüklem → satır başka tenant'a TAŞINAMAZ.
CREATE POLICY agent_registration_keys_tenant_update ON public.agent_registration_keys
  FOR UPDATE
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- (4) DELETE policy YOK → `app_tenant` denetim izini silemez (fail-closed:
--     hata değil, sessiz 0 satır). GRANT de aşağıda geri alınır — iki katman.

-- GRANT'ler açıkça (046 dersi: yeni tablonun GRANT'i migration SQL'inde olmalı).
GRANT SELECT, INSERT, UPDATE ON public.agent_registration_keys TO app_tenant;
-- 🔴 Default privileges'ın (000_init.sql:480) verebileceği DELETE geri alınır.
-- Idempotent: yetki yoksa `REVOKE` hata vermez, no-op'tur.
REVOKE DELETE ON public.agent_registration_keys FROM app_tenant;
GRANT SELECT ON public.agent_registration_keys TO app_admin;
-- cron_purger'a GRANT YOK (yukarıdaki ön-uçuş gerekçesi).

COMMENT ON TABLE public.agent_registration_keys IS
  'ADR-044 K2: tenant başına print-agent KAYIT SIRRI (bcrypt cost-12). YETKİ KAYNAĞI — POST /print/v1/agent/register''ın v2 (pk2_) dalı yalnız buradan doğrular; agents.api_key_hash artık yetki değil GÖZLEM/forensik alanıdır. Denetim izi: satırlar SİLİNMEZ (DELETE policy ve GRANT yok, cron retention''ı da dokunmaz), rotasyonda eskiye valid_until yazılır, grace sonrası revoked_at. Rotasyon tetikleyicisi yalnız apps/api/scripts/rotate-agent-key.ts (müdür UI''ı kapsam dışı, ADR-044 K8).';

COMMENT ON COLUMN public.agent_registration_keys.key_hash IS
  'bcrypt cost-12 hash. Kapsam SUNULAN DİZGENİN TAMAMIDIR (`pk2_<32hex tenant uuid>_<secret>`) ve hash kapsamında HİÇBİR normalizasyon YOKTUR — küçük harfe çevirme yalnız tenant ARAMASINDA yapılır (security-reviewer L4 düzeltmesi, 2026-11-07). Sonucu: büyük harfli hex ile yapıştırılan bir anahtar 401 verir; fail-closed, kabul. Önek kriptografik olarak sırra bağlı, bir iddia değil (ADR-042 K5 / ADR-044 K1.3). Plaintext hiçbir yerde saklanmaz: script stdout''unda BİR KEZ görünür, log/audit/Sentry/dosyaya ASLA yazılmaz.';

COMMENT ON COLUMN public.agent_registration_keys.valid_until IS
  'NULL = süresiz. Rotasyonda ESKİ satıra `now() + grace` (varsayılan 7 gün, ADR-044 K10-3) yazılır; register v2 dalı `valid_until IS NULL OR valid_until > now()` ister. ⚠️ Pencere YALNIZ yeniden kaydı sınırlar — çalışan ajan JWT refresh ile akmaya devam eder; sessiz ölüm kipi, env''i güncellenmemiş servisin grace SONRASI ilk restart''ıdır.';

COMMENT ON COLUMN public.agent_registration_keys.revoked_at IS
  'Dolu = anahtar ölü (register adaylarına girmez). `--revoke-after-grace` koşumu yazar; AYRI ve SONRAKİ bir adımdır — rotasyonun kendisi iptal ETMEZ.';

COMMENT ON COLUMN public.agent_registration_keys.created_by_user_id IS
  'Rotasyonu koşan admin kullanıcı. ON DELETE SET NULL ([[feedback_soft_delete_actor_fk_check]]) — kullanıcı silinince iz kalır, "kim" düşer. Script bu alanı gerçek bir admin''e çözemezse ÇALIŞMAYI REDDEDER (ADR-004 Amd14 K4''teki "elle SQL → audit''te karşılık yok" boşluğu).';

RESET lock_timeout;
