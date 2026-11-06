-- 069_agents_agent_version.sql
--
-- ADR-044 K4 — ajan sürüm görünürlüğü (OPS-2'nin ilk adımı), PR-1.
--
-- Ajan `GET /print/v1/jobs/next?agentVersion=` ile kendi binary sürümünü
-- bildirir; sunucu bu değeri MEVCUT `declared_kinds` gözlem UPDATE'ine ekleyip
-- bu kolona yazar (ek sorgu YOK). Yazıcı yönetim ekranı kolonu salt-okunur
-- gösterir ve `PRINT_AGENT_EXPECTED_VERSION` env'i doluysa farklı/eksik sürümü
-- "bayat" olarak işaretler.
--
-- ⚠️ NUMARA NOTU: ADR-044 metni "mig 069 = `agent_registration_keys` tablosu,
-- mig 070 = `agents` kolonları" diyor. PR SIRASI BUNU DEĞİŞTİRDİ: PR-1 auth
-- kontratına hiç dokunmadığı için önce iniyor ve yalnız `agent_version`
-- getiriyor; `agent_registration_keys` + `agents.registration_key_id` PR-2'de
-- (security-reviewer imzası şart) gelecek ve SONRAKİ numarayı alacak.
-- [[feedback_adr_prewritten_inventory_restale]] — numara envanteri koddan
-- yeniden sayıldı: head bugün 068 (`068_tenants_slug_format.sql`).
--
-- ACİL ROLLBACK (operatör manuel):
--   ALTER TABLE public.agents DROP COLUMN IF EXISTS agent_version;
-- Yalnız bir gözlem alanı kaybolur; veri kaybı riski yoktur (fiş/sipariş/ödeme
-- ilişkisi yok).
--
-- 🔴 **SIRA BAĞLAYICI — kolonu ÖNCE düşürmek baskıyı DURDURUR.** Dosyanın ilk
-- hâli *"baskı yolu, claim SQL'i ve auth bu kolonu okumaz"* diyordu; bu yalnız
-- **okuma** için doğru. Kod taraması (db-migration-guard kapısı, 2026-11-06):
--   · `print-jobs.ts:323` — `jobs/next` gözlem UPDATE'i `void`/fire-and-forget
--     → poll düşmez ✅
--   · `print-jobs.ts:797` ve `:818` — **register `await`'li, aynı transaction**
--     → kolon yoksa `42703` → `POST /agent/register` **500**, yeniden boot eden
--     ajan kaydolamaz
--   · `printers.ts:267` — admin yazıcı listesi SELECT → **500**, ekran açılmaz
-- Yani doğru sıra: **(1) API'yi önceki sürüme al → (2) ancak sonra kolonu
-- düşür.** Daha iyisi: **kolonu BIRAK** — nullable, okunmazsa zararsız,
-- forward-only disiplini (ADR-003) de bunu söyler. Kolonu düşürmek yalnız
-- şema temizliği için ve API eski sürümdeyken yapılır.
--
-- 🔒 KİLİT PROFİLİ: nullable + DEFAULT YOK → Postgres 11+ tablo yeniden
-- yazımı yapmaz; `ALTER` yalnız katalog günceller (ms'ler). `agents` sıcak
-- yolda (her poll `last_seen_at` yazıyor) ama AccessExclusive süresi ihmal
-- edilebilir. Kapalı-restoran penceresi ŞART DEĞİL.
--
-- 🔑 RLS/GRANT GEREKMİYOR: `agents` mig 064'te force-RLS altına girdi ve
-- `app_tenant`'ın SELECT/INSERT/UPDATE/DELETE GRANT'leri TABLO seviyesindedir
-- (kolon seviyesinde değil) → yeni kolon mevcut yetkiye otomatik dahildir,
-- yeni `GRANT`/`POLICY` ifadesi gerekmez. `cron_purger`'ın `agents` üzerinde
-- yetkisi yok ve bu kolon retention hattına girmiyor.
--
-- Idempotent (ADR-003 §16): `IF NOT EXISTS` — kolon prod'a elle eklenmiş ama
-- `pgmigrations` satırı yoksa yeniden koşum 42701 vermez.

-- 🔒 `lock_timeout` — 064'ten beri kesintisiz konvansiyon (064 · 065 · 066 ·
-- 067 · 068), desen 068:53/:65. ⚠️ **Risk ALTER'ın SÜRESİ DEĞİL, KUYRUKLANMA:**
-- `agents` sıcak yolda (her poll `last_seen_at` yazıyor). Tabloda açık bir
-- transaction varsa bekleyen AccessExclusive'in ARKASINA her agent sorgusu
-- dizilir → poll bloke olur → **baskı durur** (`064_rls_agents.sql:181-187`
-- aynı riski bu tablo için zaten yazmış). node-pg-migrate `.sql`'i tek
-- transaction'da koşar; timeout olmazsa SINIRSIZ bekler. 3 sn'de alamazsa
-- migration patlar ve bu DOĞRU davranıştır: baskıyı durdurmaktan iyidir.
-- `SET LOCAL` COMMIT'te düşer, yine de dosya sonunda `RESET` edilir (068 deseni).
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS agent_version TEXT NULL;

-- COMMENT kysely-codegen'in JSDoc kaynağıdır ([[feedback_codegen_jsdoc_from_comment]]).
COMMENT ON COLUMN public.agents.agent_version IS
  'ADR-044 K4: ajanın kendi bildirdiği binary sürümü (jobs/next?agentVersion= veya register gövdesi), fire-and-forget yazılır. GÖZLEM alanı — OTORİTER DEĞİL: claim filtresinde, auth''ta ve fiş render''ında KULLANILMAZ. Biçim ^\d+\.\d+\.\d+$; geçersiz değer NULL''a düşer (istek 400 OLMAZ, baskı poll''u düşmez). NULL = sürüm bildirmeyen eski build ya da hiç poll etmemiş yeni kayıt.';

RESET lock_timeout;
