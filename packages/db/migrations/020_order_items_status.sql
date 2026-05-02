-- 020_order_items_status.sql
-- ADR-013 §6 (qty 0 persisted = soft cancel) + §9.2 (comp toggle) implementasyonu
-- için order_items.status kolonu.
--
-- Bağlam:
-- - PR-5 (Persisted adisyon — MEVCUT ÜRÜNLER + void akışı) için zorunlu.
-- - v3 paritesi: order_items.status FSM (`new → sent → preparing → ready →
--   served → cancelled`); 'comped' v3'te enum değeri ama v5'te ayrı bool flag
--   (`is_comped`, mevcut kolon) ile sadeleştirildi — comp toggle ayrı concern.
-- - 'cancelled' soft-delete davranışı: total_cents recalc'ta dışlanır
--   (bkz. orders.ts repo `updateItem` total_cents subquery).
--
-- Phase mapping:
-- - 'new': v5 PR-4'te oluşturulan default (henüz mutfağa gönderilmemiş)
-- - 'sent', 'preparing', 'ready', 'served': KDS integration Phase 3 (PR-10
--   sonrası kitchen ekranı; şimdilik enum'da yer rezervasyonu)
-- - 'cancelled': PR-5 void akışı (PATCH /orders/:orderId/items/:itemId)
--
-- Backfill: mevcut satırlar (Phase 1 fixture) NOT NULL DEFAULT 'new' ile
-- otomatik 'new' olarak doldurulur.
--
-- Index: status'a göre filter raporlama Phase 3+ scope; MVP'de yok.

-- ============================================================================
-- 1. order_item_status ENUM type (idempotent)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'order_item_status'
  ) THEN
    CREATE TYPE order_item_status AS ENUM (
      'new',
      'sent',
      'preparing',
      'ready',
      'served',
      'cancelled'
    );
  END IF;
END$$;

-- ============================================================================
-- 2. order_items.status kolonu — DEFAULT 'new', NOT NULL
-- ============================================================================
-- ADD COLUMN ile DEFAULT verirsek PG 11+ metadata-only operation (instant).
-- Mevcut satırlar otomatik 'new' alır.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS status order_item_status NOT NULL DEFAULT 'new';
