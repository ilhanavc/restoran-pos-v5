-- 021_order_items_variant_snapshot.sql
-- ADR-013 §11 Karar 11.3 (Session 51) — porsiyon MVP'ye geri çekildi.
--
-- order_items tablosuna 3 snapshot kolonu eklenir; FK YOK (variant soft-delete
-- edilse snapshot kalır, ADR-003 §7 snapshot invariant). Mevcut satırlar NULL
-- (geriye uyumluluk; PR-6b öncesi siparişlerde porsiyon yok).
--
-- ADD COLUMN ile DEFAULT NULL → PG 11+ metadata-only operation (instant).
--
-- Forward-only (ADR-003 §15). Idempotent.

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS variant_id_snapshot UUID NULL,
  ADD COLUMN IF NOT EXISTS variant_name_snapshot VARCHAR(80) NULL,
  ADD COLUMN IF NOT EXISTS variant_price_delta_cents_snapshot INTEGER NULL;
