-- Migration 048 — ADR-032 Amendment 1 (mutfak istasyon yönlendirmesi)
--
-- Forward-only (ADR-003 §9.5c) — DOWN migration yok.
--
-- NEDEN: Restoranda iki mutfak yazıcısı var (FIRIN + IZGARA). v5 bugüne kadar
-- tek mutfak hattı (`payload.kind='kitchen'`) taşıyordu → pişecek tüm kalemler
-- tek fişte çıkıyor, fırıncı ile ızgaracı aynı kâğıda bakıyordu. Bu kolon,
-- kategori bazında HANGİ mutfak yazıcısının basacağını belirler.
--
-- ANLAMI: NULL = taban istasyon (`kitchen` = FIRIN, bugünkü davranış).
-- Geçerli değerler `KITCHEN_STATION_KINDS` alt kümesidir (shared-types):
-- şu an 'kitchen' | 'grill'. Doğrulama **enqueue'da** yapılır (ADR-032 Amd1 K5);
-- DB CHECK constraint bilinçli olarak YOKTUR — migration'ı additive-only ve
-- tablo-yeniden-yazımsız tutmak cutover'a yakın kritiktir (K8/K12-10).
--
-- OKUYAN TEK YER: enqueue (mutfak + iptal fişi). `kitchen_print` bayrağı
-- DEĞİŞMEZ ve ortogonaldir — KDS görünürlüğü + sent-transition tek otoritesi
-- olarak kalır (ADR-020 K2). Bu kolon yalnız "hangi yazıcı" sorusunu yanıtlar;
-- "mutfağa gider mi" sorusunu değil.
--
-- GÜVENLİ: nullable · DEFAULT yok (tablo yeniden yazımı YOK) · NOT NULL yok ·
-- index yok · CHECK yok · backfill yok. Deploy anında davranış DEĞİŞMEZ
-- (tüm satırlar NULL → hepsi taban istasyona düşer).
--
-- ⛔ `DROP COLUMN print_station` RUNBOOK'TA YASAKTIR: canlı API bu kolonu
-- okurken düşürmek her enqueue'yu 42703 ile patlatır ve mutfak basımını
-- tamamen durdurur. Kolon nullable ve nötr olduğundan düşürmenin operasyonel
-- değeri de yoktur. Geri alma veri seviyesindedir (ADR-032 Amd1 K10).

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS print_station TEXT;

COMMENT ON COLUMN categories.print_station IS
  'ADR-032 Amd1: bu kategorinin mutfak fişini hangi istasyon yazıcısının basacağı. NULL = taban istasyon (kitchen). Geçerli değerler shared-types KITCHEN_STATION_KINDS alt kümesi (kitchen | grill); doğrulama enqueue''da, DB CHECK yok. kitchen_print bayrağından ORTOGONAL: o "mutfağa gider mi", bu "hangi yazıcı" sorusunu yanıtlar.';
