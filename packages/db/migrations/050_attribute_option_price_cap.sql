-- Migration 050 — ADR-012 Amendment 1 (özellik ek ücreti tavanı: ±100 TL → ±1.000 TL)
--
-- Forward-only (ADR-003 §9.5c) — DOWN migration yok.
--
-- NEDEN: Ürün sahibi 2026-07-22'de menüye "duble kaşarlı" özelliğini **130 TL**
-- ek ücretle eklemek istedi ve ekran "eklenemedi" dedi. Sebep tavandı:
-- ADR-012 Karar 4 ek ücreti ±10000 kuruş (±100 TL) ile sınırlamıştı. Sınır
-- yazım hatasına karşı korumak için konmuştu, ama gerçek menüde 100 TL'yi aşan
-- meşru ekler var (duble malzeme, büyük porsiyon farkı) → tavan işin gerçeğine
-- uymuyordu.
--
-- ÇİFT SAVUNMA: aynı sınır hem zod şemasında (shared-types/attribute.ts) hem
-- burada CHECK olarak duruyor. YALNIZ birini değiştirmek yetmez — zod gevşetilip
-- CHECK bırakılsaydı istek doğrulamayı geçer, INSERT 23514 ile patlardı
-- (kullanıcıya yine "eklenemedi", ama bu kez 500 olarak). İkisi birlikte gider.
--
-- YENİ TAVAN: ±100000 kuruş = ±1.000 TL. Tavan KALDIRILMADI — kuruş/TL
-- karıştırmasına karşı koruma sürüyor (130 TL yerine 13000 TL yazılırsa hâlâ
-- reddedilir).
--
-- VERİ ETKİSİ: mevcut satırların hepsi yeni aralığın içinde (eski tavan daha
-- dardı) → backfill/veri düzeltme YOK, satır yeniden yazımı YOK. Tablo küçük
-- (menü özellik seçenekleri), ADD CONSTRAINT taraması milisaniyeler sürer.
--
-- GERİ ALMA: kod revert + bu CHECK'i eski aralığa çeken yeni bir migration.
-- Constraint'i DROP edip bırakmak YASAK — tavan sessizce yok olur.

ALTER TABLE attribute_options
  DROP CONSTRAINT IF EXISTS attribute_options_extra_price_cents_check;

ALTER TABLE attribute_options
  ADD CONSTRAINT attribute_options_extra_price_cents_check
  CHECK (extra_price_cents >= -100000 AND extra_price_cents <= 100000);

COMMENT ON COLUMN attribute_options.extra_price_cents IS
  'Ek ücret (kuruş, işaretli). Tavan ±100000 = ±1.000 TL (ADR-012 Amendment 1). Aynı sınır zod şemasında da vardır; ikisi birlikte değişir.';
