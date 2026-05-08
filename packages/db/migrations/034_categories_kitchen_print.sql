-- Migration 034 — Sprint 12 PR-2a (ADR-020 K2)
-- Numara: 033 yerine 034 (PR #110 33_users_username_unique.sql kullanıyor; FIFO sıralama)
--
-- KDS routing kuralı: kategori `kitchen_print=true` ise siparişteki o
-- kategori kalemleri mutfak ekranına (KDS) düşer. Default TRUE — mevcut
-- kategoriler MVP davranışında geriye dönük uyumlu (yemek mutfağa, içecek
-- admin sonradan false yapar).
--
-- ADR-020 K2: KDS, ADR-014 §8 kitchen ticket print ile birebir aynı kalemler
-- üstünde çalışır (`kitchen_print=true`). İçecek/sıcak içecek false → KDS'e
-- düşmez (bar/kasa hattı).
--
-- Geriye dönük uyumluluk: mevcut DB satırları DEFAULT TRUE alır; admin
-- sonradan kategori bazında false yapabilir (Sprint 12 PR-3 admin UI).

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS kitchen_print BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN categories.kitchen_print IS
  'ADR-020 K2: TRUE ise bu kategori altındaki sipariş kalemleri KDS''e düşer + mutfak ticket print''i tetikler. Default TRUE (mevcut yemek kategorileri); içecek vb. bar/kasa hattı için admin sonradan FALSE yapar.';
