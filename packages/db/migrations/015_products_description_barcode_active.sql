-- 015_products_description_barcode_active.sql
-- Sprint 8c PR-E2 — V3 ürün detay sayfası paritesi (MenuProductEditorPage.jsx).
--
-- Eklenen kolonlar:
-- - description : V3 "Açıklama" textarea (opsiyonel, serbest metin)
-- - barcode     : V3 "Barkod" input (opsiyonel, max 64 char; benzersizlik
--                 zorlanmaz — aynı barkod farklı ürünlerde kullanılabilir,
--                 örn. mevsimlik ürün rotasyonu)
-- - is_active   : V3 "Menüde aktif" checkbox; false → sipariş ekranında
--                 listelenmez. DEFAULT true (mevcut ürünler aktif kalır).
--
-- Kapsam dışı (kullanıcı talebiyle): combo_id, image_url, printer_target.
-- Yazıcı atama Phase 3 (ADR-011 Amendment 2026-05-01 Karar 5).
--
-- Forward-only (ADR-003 §15). Idempotent (Migration 002-007 paterni).

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS barcode VARCHAR(64);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Privileges: app_tenant otomatik (000_init.sql ALTER DEFAULT PRIVILEGES).
