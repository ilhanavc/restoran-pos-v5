-- 019_order_items_actor_snapshot.sql
-- ADR-013 §5 (Adisyon panel: persisted satır actor rozeti) implementasyonu için
-- order_items tablosuna actor (kim tarafından eklendi) snapshot kolonları.
--
-- Bağlam:
-- - PR-4 (Kaydet → POST /orders + items) sırasında her order_item insert
--   edilirken `created_by_user_id` (FK users) + `created_by_name` (text snapshot)
--   doldurulur. UI sağ panelde "İLHAN AVCI · 23:02" rozeti bu alanlardan üretilir.
-- - `created_by_user_id` ON DELETE SET NULL — kullanıcı hard-deleted olursa
--   FK NULL'a düşer (ADR-002 §10.10 hard delete davranışı), snapshot
--   `created_by_name` text alanı korunur (forensic kanıt).
-- - v3 paritesi: v3'te `created_by_name` adıyla aynı bilgi var
--   (`docs/v3-reference/order-flow-deep.md` §4 — order-flow-deep doğrulaması).
--
-- Kapsam:
-- - Yalnız idempotent ALTER TABLE ADD COLUMN (defansif `IF NOT EXISTS`)
-- - Backfill yok: mevcut order_items satırları (Phase 0/1 fixture data) için
--   kolonlar NULL kabul; runtime UI "Bilinmeyen kullanıcı" fallback (PR-5'te).
-- - Index yok: actor bazlı sorgu (örn. "kullanıcının yazdığı kalemler")
--   raporlama Phase 3+ scope'u; MVP'de gerekmiyor.

-- ============================================================================
-- 1. created_by_user_id (FK users, ON DELETE SET NULL)
-- ============================================================================
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'order_items_created_by_user_fk'
  ) THEN
    ALTER TABLE order_items
      ADD CONSTRAINT order_items_created_by_user_fk
      FOREIGN KEY (created_by_user_id, tenant_id)
      REFERENCES users (id, tenant_id)
      ON DELETE SET NULL
      ON UPDATE NO ACTION;
  END IF;
END$$;

-- ============================================================================
-- 2. created_by_name (TEXT snapshot — kullanıcı silinince FK NULL olsa bile
--    forensic kanıt korunur)
-- ============================================================================
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS created_by_name TEXT;
