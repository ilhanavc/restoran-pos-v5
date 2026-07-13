-- =============================================================================
-- Migration 047 — order_items + orders performans index'leri
-- =============================================================================
-- Denetim bulguları: DB-TX-04 (Blok 3) + R7-AGG-PERF-01 (Blok 7).
-- ADR-031 K12 "Amendment 2026-07-13 (Session 94)" (decisions.md:11221) —
-- canlı-veri index ekleme mekanizması.
--
-- Bağlam:
--   1) DB-TX-04: order_items'ta order_id üzerinde index YOK. FK (order_id,
--      tenant_id) PG'de otomatik index üretmez → sipariş detay/ekle/recalc/
--      iptal/birleştir path'lerindeki `WHERE order_id = ? AND tenant_id = ?`
--      sorguları Seq Scan yapıyor (orders.ts:502/588/855/1591, payments:296).
--      Yük harness boş DB'de gizledi; gerçek hacimde ısırır.
--   2) R7-AGG-PERF-01: rapor endpoint'leri (ciro/satış/ürün/kategori/anomali/
--      günlük-kapanış — 11 endpoint) `WHERE tenant_id = ? AND created_at >= ?
--      AND created_at < ?` deseniyle çalışıyor (recent-orders/top-selling/
--      category-sales/daily-close/average-bill/anomalies/user-performance).
--      orders'ta (tenant_id, created_at) kompozit index YOK; mevcut
--      (tenant_id, store_date, order_no) UNIQUE bu range'e yaramaz.
--
-- Kolon sırası:
--   - order_items (order_id, tenant_id): order_id LEADING — yüksek seçicilik
--     (bir sipariş → az kalem) + join/filtre anahtarı; tenant_id ikincil
--     tenant-scope korur.
--   - orders (tenant_id, created_at): tenant_id LEADING — her rapor sorgusunda
--     eşitlik filtresi; created_at ikincil range tarama + ORDER BY (DESC de
--     forward btree'nin backward-scan'iyle karşılanır → DESC gereksiz).
--
-- Cloud safety (ADR-031 K12 Amd 2026-07-13):
--   node-pg-migrate v7 .sql migration'ları CONCURRENTLY yapamaz (singleTransaction
--   default true + .sql parser'da direktif yok). Tek-tenant, küçük (birkaç bin
--   satır), düşük-trafik prod DB → düz CREATE INDEX + saniye-altı
--   AccessExclusiveLock kabul edilir; deploy restoran KAPALIYKEN yapılır
--   (off-hours). db-migration-guard MANUEL onayı + forward-only. Migration
--   041/042 emsalinin sürdürülmesi. CONCURRENTLY tetikleyicileri (≳500K satır /
--   multi-tenant / TS-migration altyapısı) için Amd 2026-07-13'e bak.
--
-- IF NOT EXISTS: idempotent — fresh install (pos_test) + prod'da güvenli
-- yeniden-çalıştırma (ör. deploy retry). Düz (CONCURRENTLY-olmayan) CREATE
-- INDEX atomiktir → başarısız build INVALID index bırakmaz.
--
-- Forward-only (ADR-001 §6.1.6) — rollback yok.
-- =============================================================================

-- === 1) DB-TX-04 — order_items sipariş-bazlı erişim ===
CREATE INDEX IF NOT EXISTS order_items_order_id_idx
  ON order_items (order_id, tenant_id);

-- === 2) R7-AGG-PERF-01 — orders rapor tarih-aralığı erişimi ===
CREATE INDEX IF NOT EXISTS orders_tenant_created_at_idx
  ON orders (tenant_id, created_at);
