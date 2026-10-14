-- 068_tenants_slug_format.sql
--
-- ADR-042 K1.6 — `tenants.slug` biçim kilidi (v5.1 Faz 1, adım 1).
--
-- `slug` artık operatöre görünen **işletme kodudur**: giriş ekranında yazılır ve
-- sunucu tenant'ı bu değerden çözer. Dolayısıyla biçimi serbest bırakılamaz.
--
-- ACİL ROLLBACK (operatör manuel): kısıt giriş akışını engellerse —
--   ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_slug_format;
-- Veri kaybı yoktur; yalnız bir CHECK kaldırılır.
--
-- ⚠️ NUMARA NOTU: ADR-042 metni bu migration'a "066" diyor. YANLIŞ — ADR
-- yazılırken envanter bayatlamıştı; 066 ve 067 zaten dolu. Doğru numara 068.
--
-- 🔑 NEDEN SALT ASCII — Türkçe İ/I tuzağı (S101 dersi):
-- Slug karşılaştırması büyük/küçük harf duyarsızdır. `lower('İ')` PostgreSQL'de
-- **locale'e bağlıdır** ve istemcideki `toLowerCase()` ile sunucu tarafı farklı
-- sonuç üretebilir — bu projede ad/ILIKE eşlemesi tam bu yüzden UUID'ye
-- çevrilmişti. Regex Türkçe karakter kabul etmez: `DİLAN` yazan kullanıcı
-- ayırt edilemeyen bir 401 alır ve kimse sebebini bulamaz.
--
-- 🔑 NEDEN TİREYLE BİTEMEZ (`…{0,30}[a-z0-9]$`):
-- `dilan-pide-` ile `dilan-pide` farklı slug'lardır ama operatör gözüyle aynı
-- görünür; yanlış olanı yazan kullanıcı yine ayırt edilemeyen bir 401 alır.
-- Baş/son karakteri alfanümerik zorunlu kılmak bu kozmetik tuzağı kapatır.
-- Asgari uzunluk 2, azami 32 (değişmedi).
--
-- 🔑 NEDEN AYRI `lower(slug)` INDEX'İ GEREKMİYOR:
-- CHECK `slug = lower(slug)` garantisi verdiği için mevcut `UNIQUE (slug)`
-- (000_init.sql:116) **fiilen case-insensitive tekillik** sağlar.
--
-- 🔒 KİLİT PROFİLİ — ÖNEMLİ DÜZELTME (db-migration-guard denetimi):
-- `ADD CONSTRAINT ... CHECK` `AccessExclusiveLock` alır ve bu kilit **ALTER
-- bitince değil, KOŞUMUN COMMIT'ine kadar** tutulur: node-pg-migrate tüm
-- koşumu tek transaction'a alır (migration başına SAVEPOINT yoktur).
-- `tenants` **sıcak yolda** okunuyor: giriş (`auth/tenantResolution.ts`) ve
-- fiş kuyruğa atma (`print/enqueue-*-job.ts`, fiş başlığı için).
-- AccessExclusive SELECT'i de bloklar → en kötü hâl **≤3 sn giriş + baskı
-- duraklaması**, ardından atomik ROLLBACK. Veri riski yok, kendini iyileştirir.
-- Bu yüzden: prod head'in 067 olduğu doğrulanmalı (koşumda yalnız 068 olsun)
-- ve 19:00-22:00 zirvesinde koşulmamalı. Kapalı-restoran penceresi ŞART DEĞİL.
--
-- ⚠️ `SET LOCAL` GEREKÇESİ DÜZELTİLDİ: `SET LOCAL` de tx kapsamlıdır ve tx tüm
-- koşumu kapsadığı için aynı koşumdaki SONRAKİ migration'lara **sızar** (067'nin
-- `SET LOCAL`'i bu dosya koşarken hâlâ yürürlükteydi). Düz `SET`'ten farkı,
-- COMMIT'ten sonra yaşamamasıdır. Sızmayı bu dosyayla sınırlamak için sonda
-- `RESET` yapılır.
--
-- ⚠️ SIRA BAĞLAYICI (ADR-042 K3 adım 0 → 1): prod slug'ı bu migration'dan ÖNCE
-- doğrulanmış olmalı. Doğrulandı (2026-10-13): `dilan-pide` — uyuyor, UPDATE
-- gerekmedi. Uymayan bir değer olsaydı migration burada PATLARDI; bu bilinçlidir.

SET LOCAL lock_timeout = '3s';

-- Idempotent (ADR-003 §16, mig 005/018/066 deseni): çıplak `ADD CONSTRAINT`
-- yeniden koşumda `42710` verirdi — ör. kısıt prod'a elle uygulanmış ama
-- `pgmigrations` satırı yoksa.
ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_slug_format;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_slug_format
  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$');

RESET lock_timeout;
