-- 045_order_idempotency.sql
-- ADR-013 Amendment 1 — "Sipariş Oluşturma + Kalem-Ekleme Idempotency Kontratı"
-- (FAZ 1 / PR-3; derin denetim BLOCKER M10-A-01). ADR-003 forward-only: no down.
--
-- Bağlam yorumları Türkçe (as-built gerekçe); COLUMN yorumları İngilizce
-- (kysely-codegen JSDoc kaynağı — COMMENT ON COLUMN JSDoc üretir).
--
-- Bağlam: iki sipariş-yazma endpoint'i retry'da veri bozuyor:
--   POST /orders/:id/items → her retry kalemleri DETERMİNİSTİK duplike eder
--     (2× mutfak fişi + şişik adisyon + müşteri fazla öder). DB guard YOK.
--   POST /orders → open-dine_in kısmi unique koruma verir ama istemci 409'u
--     "ilk denemem başarılı mıydı yoksa başkası mı oturdu?" diye yorumlayamaz.
-- Emsal ADR-014 §10.10 / Migration 022 ödeme idempotency deseni (kolon + UNIQUE
-- + ON CONFLICT DO NOTHING). Bu migration o deseni sipariş yazımına taşır.
--
-- Karar 5 (OPSİYONEL-BAŞLA): orders.idempotency_key NULLABLE — key gönderen
-- istemci guard'lanır, göndermeyen (eski APK sideload) legacy yolda çalışır.
-- NOT NULL flip v5.1'e ertelendi (filo güncellendiği doğrulanınca).

-- === 1) orders.idempotency_key (create guard — sipariş satırının kendisi guard) ===
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS idempotency_key UUID NULL;

COMMENT ON COLUMN orders.idempotency_key IS
  'ADR-013 Amd1: per-attempt idempotency token for POST /orders (create). NULL = legacy client (no guard, pre-Amendment behaviour). Partial UNIQUE (tenant_id, idempotency_key) WHERE NOT NULL collapses a retried create into a 200 replay instead of a duplicate order or an ambiguous 409.';

-- === 2) Partial UNIQUE — yalnız NOT NULL key'ler indekslenir ===
-- Çoklu NULL (legacy) çakışmaz; predicate açık (enum-migration index-predicate
-- WHITELIST dersi). ON CONFLICT arbiter'ı bu partial index'i hedeflemek için
-- WHERE predicate'ini repo'da tekrarlar (Kysely onConflict().where()).
CREATE UNIQUE INDEX IF NOT EXISTS orders_tenant_idempotency_key_uq
  ON orders (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- === 3) order_item_batches (addItems guard — batch marker tablosu) ===
-- addItems 1:N (bir sipariş N kez kalem-ekleme alır); key İSTEĞE/BATCH'e ait.
-- order_items çok-satırlı → üstüne unique konamaz. Tek-satırlık marker tablo:
-- guard satırı = batch marker (payments "payment satırı = guard" deseninin
-- birebir analogu). Replay'de kalemler yeniden EKLENMEZ; güncel sipariş
-- findByIdWithItems ile döner.
CREATE TABLE IF NOT EXISTS order_item_batches (
  id                 UUID        PRIMARY KEY,
  tenant_id          UUID        NOT NULL REFERENCES tenants (id),
  order_id           UUID        NOT NULL,
  batch_key          UUID        NOT NULL,
  created_by_user_id UUID        NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Composite tenant FK (ADR-003 çok-tenant konvansiyonu; orders UNIQUE (id,
  -- tenant_id) hedefi) + ON DELETE CASCADE ŞART (cross-FK test cleanup zinciri
  -- dersi: DELETE FROM tenants/orders 23503 vermesin — marker sipariş silinince
  -- otomatik gider).
  FOREIGN KEY (order_id, tenant_id) REFERENCES orders (id, tenant_id) ON DELETE CASCADE,
  -- Idempotency guard: aynı tenant'ta aynı batch_key tek kez → retry DO NOTHING.
  UNIQUE (tenant_id, batch_key)
);

COMMENT ON TABLE order_item_batches IS
  'ADR-013 Amd1: single-row idempotency marker for POST /orders/:id/items (addItems). One row per accepted item-add batch; UNIQUE (tenant_id, batch_key) makes a retried add-items request collapse into a 200 replay (items are NOT re-inserted, no duplicate kitchen ticket). NOT a snapshot store — the replay response returns the live order via findByIdWithItems.';
COMMENT ON COLUMN order_item_batches.batch_key IS
  'ADR-013 Amd1: per-attempt idempotency token for one add-items request. NOT NULL — a row exists only for a key-bearing request; legacy keyless clients bypass this table entirely (items inserted directly = pre-Amendment behaviour).';
COMMENT ON COLUMN order_item_batches.created_by_user_id IS
  'ADR-013 Amd1: actor who created the batch (users.id). FK ON DELETE SET NULL — user hard-delete nulls the actor but keeps the marker. Deliberately NOT in an all-or-none CHECK (soft-void actor-FK lesson: 23503/23514 avoidance).';
