-- 046_order_item_batches_grants.sql
-- Migration 045 lives migrator-run olarak koştuğunda yeni tablo migrator-owned
-- oluşur ve prod'daki tek default-ACL (FOR ROLE postgres) UYGULANMAZ →
-- app_tenant (API rolü) tabloya erişemez, addItems idempotency yolu runtime'da
-- permission-denied alır (deploy.md §6 "yeni tablo yaratan migration'da
-- app_tenant GRANT'ı migration SQL'inde olmalı" dersi — 045'te eksik kalmıştı,
-- deploy ön-kontrolünde yakalandı).
--
-- Grant seti ev-deseniyle birebir (pg_default_acl app_tenant=arwd:
-- SELECT/INSERT/UPDATE/DELETE — diğer tüm tablolarla tutarlı; migrator REVOKE
-- kontratı [deploy.md §6] app_tenant'ı kısıtlamaz). Sequence yok (UUID PK).
-- Idempotent: GRANT tekrar koşulabilir; fresh-install'da (postgres-owned,
-- default-ACL zaten uygulanmış) zararsız no-op etkisi.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_item_batches TO app_tenant;
GRANT SELECT ON public.order_item_batches TO app_admin;
