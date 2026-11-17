-- 072_tenant_settings_receipt_text.sql
--
-- ADR-045 K2 + K5 (Accepted 2026-11-17) — işletmenin kendi fiş metni ve paket
-- fişinin otomatik baskı anahtarı. PR-1 (render yolu, davranış-nötr).
--
-- NEDEN `tenant_settings`'e KOLON (yeni tablo değil): ürün sahibi K12-1'de
-- "her fişte aynı metin" dedi → belge türü ekseni yok, kolon = tür × alan
-- çarpımı doğmuyor. `tenant_settings` zaten işletme başına tek satır ve mig
-- 061'den beri force-RLS'li → yeni RLS/GRANT yüzeyi açılmaz.
--
-- 🔴 BACKFILL YOK (ADR-045 K3.1): metin kolonları `NULL` açılır ve öyle kalır.
-- `NULL` = "şablonun gömülü varsayılanını bas" = BUGÜNKÜ fiş. Bugünkü kapanış
-- metni ("Afiyet olsun" vb.) kolonlara KOPYALANMAZ: kopyalansaydı metin iki
-- yerde (şablon kodu + her işletmenin satırı) yaşardı ve geri dönüş "orijinal
-- değeri bilmek"e dayanırdı. `NULL` saklanması gerekmeyen tek değerdir.
--
-- 🔴 `NULL` ≠ `'{}'` (ADR-045 K3.2): `receipt_footer_lines IS NULL` = gömülü
-- alt bilgi; `= '{}'` = hiç alt bilgi basma (işletmenin bilinçli tercihi).
-- Ayrım çözümleyicide (`resolveReceiptText`, shared-domain) yaşar.
--
-- DB'DE UZUNLUK/İÇERİK CHECK'İ YOK (ADR-045 K2): satır sayısı, satır uzunluğu
-- ve izinli karakter kümesinin TEK kaynağı `shared-types` (`RECEIPT_TEXT_LIMITS`
-- + `ReceiptLinesSchema`). DB'ye ikinci bir sayı yazmak ikisinden birinin
-- bayatlaması demektir. Elle SQL ile girilmiş bozuk değeri render anındaki
-- doğrulama karşılar → kod varsayılanıyla basılır (fail-OPEN, K9).
--
-- Forward-only (ADR-003 §15). Idempotent (ADR-003 §16). DOWN migration YOK.
--
-- 🔴 ACİL ROLLBACK (operatör manuel) — önce VERİ, şema gerekmez:
--   Ayarı kapatmak için kolonu düşürmek GEREKMEZ (ADR-045 K9):
--     UPDATE tenant_settings SET receipt_header_lines = NULL,
--       receipt_footer_lines = NULL, packing_auto_print_enabled = true
--       WHERE tenant_id = '<uuid>';
--   ya da API env'inde `RECEIPT_TEXT_ENABLED=false` + restart (DB'ye dokunmaz).
--   ⛔ `DELETE FROM tenant_settings` ASLA: mig 028'in trigger'ı satırı olmayan
--   işletmede sipariş INSERT'ini ENGELLER ("tenant_settings missing … orders
--   insert blocked") → o restoran sipariş giremez.
--   Kolonları gerçekten düşürmek gerekirse SIRA: (1) API'yi önceki sürüme al
--   (enqueue'lar bu kolonları `select` ediyor → kolon yoksa 42703 → fiş
--   kuyruğa yazılamaz) → (2) ancak sonra:
--     ALTER TABLE public.tenant_settings
--       DROP COLUMN IF EXISTS receipt_header_lines,
--       DROP COLUMN IF EXISTS receipt_footer_lines,
--       DROP COLUMN IF EXISTS packing_auto_print_enabled;
--   Daha iyisi: kolonları BIRAK — NULL/true iken davranış bugünküyle aynı.
--
-- 🔒 KİLİT PROFİLİ: iki nullable kolon (DEFAULT yok) + bir `NOT NULL DEFAULT
-- true` kolon (SABİT default) → PostgreSQL 11+ tablo yeniden yazımı yapmaz,
-- yalnız katalog güncellenir. Risk süre değil KUYRUKLANMA: `tenant_settings`
-- her sipariş INSERT'inde (`populate_order_store_date` trigger'ı) ve her fiş
-- enqueue'sunda okunuyor → açık bir transaction varsa bekleyen AccessExclusive
-- kilidin ARKASINA sipariş girişi dizilir. 3 sn'de kilidi alamazsa migration
-- patlar ve bu DOĞRU davranıştır (069/071 emsali). Tablo işletme başına tek
-- satır (prod: 2 satır) → index yok, index gate'i uygulanmaz.
--
-- 🔑 RLS/GRANT GEREKMİYOR: `tenant_settings` mig 061'den beri ENABLE + FORCE
-- RLS; `app_tenant` GRANT'leri TABLO seviyesinde → yeni kolonlar mevcut
-- yetkiye otomatik dâhildir. Policy (`tenant_settings_tenant_isolation`,
-- komut belirtmeyen = FOR ALL) DEĞİŞMEZ.

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS receipt_header_lines TEXT[] NULL,
  ADD COLUMN IF NOT EXISTS receipt_footer_lines TEXT[] NULL,
  ADD COLUMN IF NOT EXISTS packing_auto_print_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tenant_settings.receipt_header_lines IS
  'ADR-045 K2: işletme adının altına basılan satırlar (kasa + paket fişi). NULL = ek satır yok (bugünkü fiş). Kurallar shared-types RECEIPT_TEXT_LIMITS.';
COMMENT ON COLUMN public.tenant_settings.receipt_footer_lines IS
  'ADR-045 K2/K3.2: gömülü kapanışın YERİNE basılan satırlar. NULL = şablonun gömülü alt bilgisi (bugünkü fiş); boş dizi = hiç alt bilgi basma.';
COMMENT ON COLUMN public.tenant_settings.packing_auto_print_enabled IS
  'ADR-045 K5: paket fişinin OTOMATİK baskısı. false iken elle "Yazdır" yine basar; kasa/mutfak/iptal fişi etkilenmez.';

RESET lock_timeout;
