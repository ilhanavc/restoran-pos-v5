-- 014_categories_default_color_brand.sql
-- ADR-011 Amendment 2026-05-01 (Karar 3 micro-amend) — Sprint 8c PR-D1.
-- Brand alignment: kategori varsayılan rengi `#16a34a` (green-600) yerine
-- `#ea580c` (orange-600). Login ekranındaki amber→orange-500 brand gradient'ı
-- ile uyum (CSS --primary: 22 85% 52% → orange-500 family).
--
-- Migration 013 numarası PR-F3b (order_item_attributes snapshot) için rezerv;
-- bu migration sıralı 014 alır.
--
-- Forward-only (ADR-003 §15). Idempotent.

ALTER TABLE categories
  ALTER COLUMN color SET DEFAULT '#ea580c';

-- Mevcut yeşil-default kayıtları brand turuncuya taşı. Kullanıcı tarafından
-- elle seçilmiş diğer renkler (palette'in başka 7 swatch'ı) korunur.
UPDATE categories
   SET color = '#ea580c'
 WHERE color = '#16a34a';

-- Privileges: değişmedi (ALTER COLUMN privilege miras alınır).
