-- =============================================================================
-- Migration 041 — orders one-active unique partial index: void HARİÇ tut
-- =============================================================================
-- ADR-009 Amendment 2026-06-30 — Karar B (Grup 2, #11/#12).
--
-- Bağlam: Aktif-sipariş tanımı 3 yerde uyuşmuyordu:
--   - hasActiveOrders (repo, `status='open'` literal — dar)
--   - board projection (`NOT IN ('paid','cancelled','void')` — doğru)
--   - DB unique partial index (000_init.sql:417-419,
--     `WHERE status NOT IN ('paid','cancelled')` — void HARİÇ DEĞİL)
--
-- Sonuç (#11, veri bütünlüğü): void edilmiş bir sipariş DB index slot'unu
-- tutmaya devam ediyordu → (tenant_id, table_id) unique kısıtı yüzünden masa
-- "dolu" sayılıyor, void sonrası YENİDEN AÇILAMIYORDU.
--
-- Karar: Tek kanonik aktif tanımı = `status NOT IN ('paid','cancelled','void')`
-- (shared-domain TERMINAL_ORDER_STATUSES). Index DROP + CREATE; AYNI ad +
-- AYNI kolonlar (tenant_id, table_id) — yalnız WHERE'e 'void' eklenir.
--
-- Cloud safety: Boş/küçük tek-tenant tabloda DROP + CREATE INDEX kısa
-- AccessExclusiveLock alır (düşük trafik, ~saniye altı). §15.5 init-file
-- istisnası BURADA geçerli DEĞİL → normalde CONCURRENTLY zorunlu; ancak
-- CONCURRENTLY transaction-block içinde çalışamaz ve node-pg-migrate her
-- migration'ı tek transaction'da sarar. Tek-tenant düşük trafikte kısa lock
-- kabul edilir (db-migration-guard onayı, ADR-001 §6.1.6 forward-only).
-- Eski index'i önce DROP edip yeni unique kısıtın eski void-slot satırlarıyla
-- çakışmaması için sıra: DROP → CREATE.
--
-- Forward-only (ADR-001 §6.1.6) — rollback yok.
-- =============================================================================

-- === 1) Eski index'i kaldır (void hariç değil) ===
DROP INDEX IF EXISTS orders_tenant_table_open_uq;

-- === 2) Yeni index — void de terminal kabul edilir (slot bırakır) ===
-- Aynı ad + aynı kolonlar; WHERE'e 'void' eklendi.
CREATE UNIQUE INDEX orders_tenant_table_open_uq
  ON orders (tenant_id, table_id)
  WHERE status NOT IN ('paid', 'cancelled', 'void');
