-- 073_create_caller_bridge_keys.sql
-- rollback-compat: additive
--
-- ADR-052 K2 (Accepted 2026-11-26) — Caller ID köprüsü için TENANT'A BAĞLI
-- anahtar (`cb1_<32hex tenant uuid>_<43 base64url>`). PR-2 (K1 + K2 + K6).
--
-- NEDEN: bugünkü `BRIDGE_TOKEN` tek platform sırrıdır; tenant istemcinin
-- `X-Tenant-Id` başlığından alınır (PR-1 eski dalı canlı tenant'a kilitledi).
-- Bu tablo tenant başına ayrı, ayrı iptal edilebilen anahtarları tutar; yetki
-- YALNIZ buradaki hash eşleşmesinden gelir, önek yalnız kapsam seçer.
--
-- ADR-049 sınıfı: ADDITIVE (yeni tablo, mevcut hiçbir yol okumaz/yazmaz) →
-- ayrı geri-alma dosyası YAZILMAZ (ADR-049 K3). Forward-only (ADR-003 §15),
-- idempotent (ADR-003 §16).
--
-- 🔴 ACİL GERİ DÖNÜŞ: önce KOD (`pos-release rollback`) — eski sürüm bu
-- tabloyu hiç okumaz; tablo BIRAKILIR (okunmazsa zararsız). Düşürmek yalnız
-- şema temizliği için ve API eski sürümdeyken:
--   DROP TABLE IF EXISTS public.caller_bridge_keys;
--
-- NEDEN `agent_registration_keys` YENİDEN KULLANILMADI (ADR-052 K2): baskı
-- kayıt sorgusuna dokunmak gerekirdi, `purpose` filtresi unutulursa köprü
-- anahtarı yazıcı kaydedebilirdi (negatife dayanan güvence) ve aynı kolonda
-- iki hash şeması (bcrypt + SHA-256) karışırdı. Mekanizma aynı, tablo ayrı.
--
-- NEDEN SHA-256 (BYTEA), bcrypt DEĞİL: anahtar 256 bit rastgele değerdir
-- (parola değil); doğrulama HER gelen aramada koşar. bcrypt sızmış/sahte
-- anahtarla sel saldırısında CPU büyüteci olurdu. Emsal `refresh_tokens.token_hash`.
--
-- 🔒 KİLİT PROFİLİ: yeni tablo → mevcut hiçbir satır kilitlenmez; sipariş,
-- baskı ve köprü yolları etkilenmez. Kapalı-restoran penceresi ŞART DEĞİL.
-- `lock_timeout` yine set edilir (064'ten beri kesintisiz konvansiyon); `SET
-- LOCAL` node-pg-migrate'in tek tx'inde sonraki migration'lara sızar → dosya
-- sonunda `RESET` (068 dersi).
--
-- 🔑 GRANT ÖN-UÇUŞU (070 deseni birebir):
--   · Default privileges (`000_init.sql:480` FOR ROLE postgres + prod'da
--     `migrator` default-ACL'i, `docs/ops/deploy.md:277-282`) yeni tabloya
--     `app_tenant` için DELETE dâhil dört yetkiyi OTOMATİK verebilir → aşağıda
--     açık `REVOKE DELETE` ([[feedback_negative_guarantee_stays_green]]).
--   · GRANT'ler AÇIKÇA yazılır (046 dersi; fresh-install vs incremental farkına
--     güvenilmez).
--   · `cron_purger`: GRANT YOK, bilinçli — tablo bir DENETİM İZİDİR (hangi
--     anahtar ne zaman verildi / süresi bitti / iptal edildi); retention hattı
--     buraya dokunmaz. Yeni rol / parola / env adımı GEREKMEZ.
--
-- 🔴 POLICY ŞEKLİ — KOMUT-SPESİFİK (063/070 emsali,
-- [[feedback_generic_rls_policy_covers_all_commands]]):
--   · SELECT  → köprü doğrulaması (`cb1_` dalı) hash'i arar
--   · INSERT  → ops betiği (ADR-052 K3, PR-3) yeni anahtar ekler
--   · UPDATE  → doğrulama `last_used_at` yazar; betik `valid_until`/`revoked_at`
--   · DELETE  → YOK (policy de, GRANT da) — iz silinemez
-- Fail-closed: context set edilmezse hiçbir satır görünmez/yazılamaz
-- (`withTenant` → `set_config('app.current_tenant_id', …, true)`).
--
-- ⚠️ KIRILMA PROFİLİ: tek okuyucu `POST /bridge/caller-id/incoming`'in `cb1_`
-- dalıdır. Sarım/GRANT eksikse hash araması 0 satır → 401 → o restoranda
-- Caller ID susar (sipariş etkilenmez). Eski (paylaşımlı sır) dalı bu tabloyu
-- okumaz → canlı köprü geçiş tamamlanana kadar ETKİLENMEZ. Kapsamın kanıtı
-- negatif kontroldür (`withTenant` sök → KIRMIZI) + `current_user = 'app_tenant'`
-- ([[feedback_rls_test_harness_app_tenant_role]]).

SET LOCAL lock_timeout = '3s';

-- === caller_bridge_keys ===
-- `id` DEFAULT YOK: betik `randomUUID()` üretir (repo geneli deseni).
CREATE TABLE IF NOT EXISTS public.caller_bridge_keys (
  id                 UUID        PRIMARY KEY,
  tenant_id          UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- SHA-256(sunulan dizgenin TAMAMI) = 32 bayt. UNIQUE: aynı hash iki satırda
  -- olamaz (256 bit rastgele değerde çakışma pratikte imkânsız; kısıt yanlış
  -- elle eklemeyi yakalar) ve eşitlik araması bu index'i kullanır.
  key_hash           BYTEA       NOT NULL UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 🔑 ACTOR FK'si SET NULL, CASCADE DEĞİL ([[feedback_soft_delete_actor_fk_check]]):
  -- anahtarı veren admin silinirse iz kalır, yalnız "kim" düşer.
  created_by_user_id UUID        NULL REFERENCES public.users(id) ON DELETE SET NULL,
  valid_until        TIMESTAMPTZ NULL,
  revoked_at         TIMESTAMPTZ NULL,
  revoke_reason      TEXT        NULL,
  last_used_at       TIMESTAMPTZ NULL
);

-- Kısmi index: tenant'ın canlı anahtarları (betiğin "aktif anahtarlar" sorgusu).
-- İptal edilmiş satırlar index'e girmez → tenant başına 1-2 satır.
-- `created_by_user_id` üzerinde index YOK, bilinçli (070 ile aynı gerekçe:
-- bu kolonla hiç sorgulanmaz, yalnız denetimde okunur).
CREATE INDEX IF NOT EXISTS caller_bridge_keys_tenant_active_idx
  ON public.caller_bridge_keys (tenant_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.caller_bridge_keys ENABLE ROW LEVEL SECURITY;
-- FORCE: tablo sahibi/app rolü bile bypass edemez (yalnız ENABLE yetmez).
ALTER TABLE public.caller_bridge_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS caller_bridge_keys_tenant_select ON public.caller_bridge_keys;
DROP POLICY IF EXISTS caller_bridge_keys_tenant_insert ON public.caller_bridge_keys;
DROP POLICY IF EXISTS caller_bridge_keys_tenant_update ON public.caller_bridge_keys;

-- (1) SELECT: yalnız kendi tenant satırları (köprü doğrulaması).
CREATE POLICY caller_bridge_keys_tenant_select ON public.caller_bridge_keys
  FOR SELECT
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- (2) INSERT: yalnız kendi tenant; NULL tenant YAZAMAZ (063 deseni).
CREATE POLICY caller_bridge_keys_tenant_insert ON public.caller_bridge_keys
  FOR INSERT
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid
              AND tenant_id IS NOT NULL);

-- (3) UPDATE: `last_used_at` dokunuşu + betiğin `valid_until`/`revoked_at`
--     yazımı. `WITH CHECK` de aynı yüklem → satır başka tenant'a TAŞINAMAZ.
CREATE POLICY caller_bridge_keys_tenant_update ON public.caller_bridge_keys
  FOR UPDATE
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);

-- (4) DELETE policy YOK → `app_tenant` denetim izini silemez. GRANT de aşağıda
--     geri alınır — iki katman.

GRANT SELECT, INSERT, UPDATE ON public.caller_bridge_keys TO app_tenant;
-- 🔴 Default privileges'ın verebileceği DELETE geri alınır (idempotent no-op).
REVOKE DELETE ON public.caller_bridge_keys FROM app_tenant;
GRANT SELECT ON public.caller_bridge_keys TO app_admin;
-- cron_purger'a GRANT YOK (yukarıdaki ön-uçuş gerekçesi).

COMMENT ON TABLE public.caller_bridge_keys IS
  'ADR-052 K2: tenant başına Caller ID KÖPRÜ ANAHTARI (cb1_). YETKİ KAYNAĞI — POST /bridge/caller-id/incoming''in cb1_ dalı yalnız buradan doğrular; tenant anahtarın önekinden çözülür, X-Tenant-Id başlığı gelirse eşleşmek zorundadır. Denetim izi: satırlar SİLİNMEZ (DELETE policy ve GRANT yok, cron retention''ı dokunmaz), rotasyonda eskiye valid_until yazılır, sonra revoked_at. Anahtar verme/rotasyon yalnız ops betiğiyle (ADR-052 K3; müdür ekranı yok).';

COMMENT ON COLUMN public.caller_bridge_keys.key_hash IS
  'SHA-256 (32 bayt) — kapsam SUNULAN DİZGENİN TAMAMIDIR (`cb1_<32hex tenant uuid>_<43 base64url>`), hash kapsamında normalizasyon YOK. Öneki başka tenant''a çevirmek hash''i değiştirir → eşleşme yok → 401 (ADR-042 K5 / ADR-052 K1.1). Düz metin hiçbir yerde saklanmaz; log/audit/Sentry''ye ASLA yazılmaz.';

COMMENT ON COLUMN public.caller_bridge_keys.valid_until IS
  'NULL = süresiz. Rotasyonda ESKİ satıra `now() + grace` (varsayılan 7 gün, ADR-052 K3.3) yazılır; doğrulama `valid_until IS NULL OR valid_until > now()` ister. Köprü her aramada doğrulandığı için grace bitince eski anahtar HEMEN susar.';

COMMENT ON COLUMN public.caller_bridge_keys.revoked_at IS
  'Dolu = anahtar ölü (doğrulamada eşleşmez). Betiğin revoke kipi yazar (grace sonrası ya da sızıntıda hemen).';

COMMENT ON COLUMN public.caller_bridge_keys.last_used_at IS
  'Yalnız BAŞARILI doğrulamadan sonra, en fazla 5 dakikada bir yazılır (ADR-052 K2). Geçişin doğrudan kanıtı: yeni anahtarın last_used_at''i tazeyse köprü yeni anahtarla çalışıyordur; 200 yanıtı tek başına kanıt değildir.';

COMMENT ON COLUMN public.caller_bridge_keys.created_by_user_id IS
  'Anahtarı veren admin kullanıcı. ON DELETE SET NULL — kullanıcı silinince iz kalır, "kim" düşer. Betik bu alanı gerçek bir admin''e çözemezse çalışmayı reddeder (ADR-052 K3.1).';

RESET lock_timeout;
