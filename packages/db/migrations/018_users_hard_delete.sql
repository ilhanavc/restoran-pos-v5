-- 018_users_hard_delete.sql
-- ADR-002 §10.10 Amendment (2026-05-01): Soft delete → Hard delete.
--
-- Görev 35 (Users UI, Session 49) manuel testinde silinmiş kullanıcının
-- email'inin yeniden kullanılamadığı UX bug'ı keşfedildi (003 migration
-- `users_tenant_email_ci_idx` UNIQUE constraint partial değil). Soft delete'in
-- audit/recovery faydası bu UX maliyetini karşılamadığı için users tablosu
-- hard delete davranışına geçirilir.
--
-- Adımlar:
--   1. refresh_tokens FK ON DELETE CASCADE'e çevrilir
--      (default RESTRICT → CASCADE; user silinince refresh token satırları
--      otomatik silinir, manuel revoke transaction step kalkar)
--   2. Mevcut soft-deleted user satırları gerçekten silinir
--      (CASCADE refresh_tokens'ı temizler; audit_logs.actor_user_id +
--      orders.waiter_user_id mevcut SET NULL davranışıyla NULL'a düşer)
--   3. users.deleted_at kolonu kaldırılır
--
-- FK ON DELETE özetleri (mevcut + bu migration):
--   - audit_logs.actor_user_id        → SET NULL  (000_init.sql:358, korunur)
--   - orders.waiter_user_id           → SET NULL  (005, korunur)
--   - refresh_tokens (user_id,tenant) → CASCADE   (BU MIGRATION)
--
-- Idempotency: forward-only, runner schema_migrations tablosu üzerinden
-- re-run'ı engeller. IF EXISTS / DO block kemeri defansif.

-- ============================================================================
-- 1. refresh_tokens FK ON DELETE CASCADE
-- ============================================================================
-- 002 migration FK'i isimsiz tanımladı; Postgres otomatik ad atadı. pg_constraint
-- üzerinden dinamik bul + drop (cluster taşıma + ad varyasyonu defansif).

DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT conname INTO fk_name
  FROM pg_constraint
  WHERE conrelid = 'refresh_tokens'::regclass
    AND contype = 'f'
    AND confrelid = 'users'::regclass;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE refresh_tokens DROP CONSTRAINT %I', fk_name);
  END IF;
END$$;

ALTER TABLE refresh_tokens
  ADD CONSTRAINT refresh_tokens_user_fk
  FOREIGN KEY (user_id, tenant_id)
  REFERENCES users (id, tenant_id)
  ON DELETE CASCADE
  ON UPDATE NO ACTION;

-- ============================================================================
-- 2. Mevcut soft-deleted satırları hard delete
-- ============================================================================
-- audit_logs.actor_user_id SET NULL ile audit kaydı korunur.
-- orders.waiter_user_id SET NULL ile sipariş geçmişi korunur (Phase 2+).
-- refresh_tokens CASCADE (yukarıdaki 1. adım) ile token satırları silinir.

DELETE FROM users WHERE deleted_at IS NOT NULL;

-- ============================================================================
-- 3. users.deleted_at kolonu DROP
-- ============================================================================
-- Hard delete davranışında soft delete kolonu anlamsız. Mevcut migration'larda
-- users üzerinde `deleted_at IS NULL` partial index YOK (000_init.sql line
-- 438-447 yalnız products/categories/customers/tables için), drop edilecek
-- bağımlı index yok.

ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;
