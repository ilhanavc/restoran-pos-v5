-- 017_create_order_item_attributes.sql
-- Sprint 8c PR-F3b — Sipariş kalemine özellik (variant + attribute) snapshot.
--
-- Aktif kullanım Phase 3'te (sipariş modülü). Bu migration sadece DB altyapısı:
-- order_items INSERT'inde, nested order_item_attributes INSERT ile o anki
-- attribute_group + attribute_option (varyant veya ek özellik) anlık state'i
-- snapshot olarak saklanır. Snapshot kuralı (ADR-003 §7) — sonraki gruplama/
-- option değişiklikleri sipariş geçmişini bozmaz.
--
-- Schema kararları:
-- - id UUID PK — yeni satır identifier
-- - tenant_id NOT NULL FK tenants — multi-tenant izolasyon
-- - order_item_id NOT NULL FK order_items — composite (id, tenant_id) tenant
--   tutarlılığı için
-- - attribute_group_id, attribute_option_id NOT NULL — referans (FK ile değil:
--   option soft-delete edildikten sonra snapshot referans tutmaya devam eder;
--   raporlama için id öğrenmek gerekirse audit log + snapshot ad alanı yeterli)
-- - group_name_snapshot, option_name_snapshot VARCHAR(80) NOT NULL — anlık
--   ad kopyası (ADR-003 §7 snapshot kuralı)
-- - extra_price_cents_snapshot INTEGER NOT NULL — option fiyat farkı kopyası
--   (siparişte ek ücret nasıl hesaplandı net görünür)
-- - created_at TIMESTAMPTZ DEFAULT now()
--
-- Index: (order_item_id) hızlı join lookup için.
--
-- Forward-only (ADR-003 §15). Idempotent.

CREATE TABLE IF NOT EXISTS order_item_attributes (
  id                          UUID         PRIMARY KEY,
  tenant_id                   UUID         NOT NULL REFERENCES tenants(id),
  order_item_id               UUID         NOT NULL,
  attribute_group_id          UUID         NOT NULL,
  attribute_option_id         UUID         NOT NULL,
  group_name_snapshot         VARCHAR(80)  NOT NULL,
  option_name_snapshot        VARCHAR(80)  NOT NULL,
  extra_price_cents_snapshot  INTEGER      NOT NULL,
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  FOREIGN KEY (order_item_id, tenant_id)
    REFERENCES order_items (id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_order_item_attributes_item
  ON order_item_attributes(order_item_id);

CREATE INDEX IF NOT EXISTS idx_order_item_attributes_tenant_created
  ON order_item_attributes(tenant_id, created_at);

-- Privileges: app_tenant otomatik (000_init.sql ALTER DEFAULT PRIVILEGES).
