-- 012_categories_icon_color.sql
-- ADR-011 Amendment 2026-05-01 Karar 2 + Karar 3 (Sprint 8c PR-D-mig)
-- Kategori kartı + Yeni Kategori drawer için ikon ve renk kolonları.
--
-- icon  : VARCHAR(40) — lucide-react PascalCase isim. Whitelist (18 ikon)
--         zod katmanında enforce edilir; DB'de string string kalır (genişleme
--         migration'sız ADR amendment ile yapılabilir). Default UtensilsCrossed.
-- color : VARCHAR(7) — `#RRGGBB` lowercase. 8 swatch palet whitelist'i zod
--         katmanında; DB'de format CHECK (HEX `^#[0-9a-f]{6}$`). Default green-600.
--
-- Forward-only (ADR-003 §15) — DOWN script yasak.
-- Idempotent — IF NOT EXISTS + DO $$ guard (Migration 002-007 paterni).

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS icon  VARCHAR(40) NOT NULL DEFAULT 'UtensilsCrossed';

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS color VARCHAR(7)  NOT NULL DEFAULT '#16a34a';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'categories_color_format_check'
  ) THEN
    ALTER TABLE categories
      ADD CONSTRAINT categories_color_format_check
      CHECK (color ~ '^#[0-9a-f]{6}$');
  END IF;
END $$;

-- Privileges: app_tenant otomatik (000_init.sql ALTER DEFAULT PRIVILEGES).
