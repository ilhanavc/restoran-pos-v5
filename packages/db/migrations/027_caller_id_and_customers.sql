-- 027_caller_id_and_customers.sql
-- ADR-016 §11 (Karar 11.6 + Amendment 1) — Caller ID + müşteri yönetimi foundation.
--
-- Forward-only (ADR-003 §15). Mevcut `customers` ve `customer_phones` tabloları
-- (000_init.sql §7-8) MVP iskeletti; bu migration alanları genişletir + iki yeni
-- tablo ekler (`customer_addresses`, `call_logs`) ve `tenant_settings`'e Caller ID
-- istasyon ataması + bypass pattern listesi ekler.
--
-- DİKKAT:
--   - `customers` ve `customer_phones` zaten composite FK (id, tenant_id) kullanıyor;
--     yeni tablolar (`customer_addresses`, `call_logs`) aynı kalıbı izler.
--   - `customers.full_name` ve `customer_phones.normalized_phone` zaten var;
--     yeniden CREATE etmiyoruz — sadece eksik alanları ALTER ile ekliyoruz.
--   - `orders.customer_id` (000_init.sql L251) zaten mevcut — yeniden eklemiyoruz.

-- === 1) customers — eksik alanları ekle ===
-- MVP iskelette (000_init.sql §7) `notes`, `is_blacklisted`, blacklist_reason`,
-- `total_orders`, `last_order_at`, `legacy_v3_no` yoktu. ADR-016 §11 gereği
-- denormalize sayaç (total_orders, last_order_at) backend trigger ile
-- güncellenecek (PR-8b kapsamı). `legacy_v3_no` opsiyonel — v3 import script (PR-8f).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_blacklisted    BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS blacklist_reason  TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_orders      INTEGER     NOT NULL DEFAULT 0 CHECK (total_orders >= 0);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_order_at     TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS legacy_v3_no      BIGINT;

-- 000_init.sql `customers.note` (tekil, TEXT) zaten var; PR-8a `notes`
-- (ADR-016 zod schema) ile farklı isim. Yeniden adlandırmak yerine alias
-- view PR-8b'de kurulacak; bu migration tek satır şema değişikliği yapmaz.

-- legacy_v3_no için tenant kapsamlı UNIQUE (NULL'lar tekrarlayabilir).
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_legacy_v3_no
  ON customers (tenant_id, legacy_v3_no)
  WHERE legacy_v3_no IS NOT NULL;

-- Tenant filtreli list/search hızlandırması.
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers (tenant_id);

-- === 2) customer_phones — eksik alanları ekle ===
-- 000_init.sql §8 sadece `normalized_phone` tutuyordu; ADR-016 §11 ham giriş
-- ve flag'ler de saklanmalı (görüntü + cep/sabit ayrımı için).
ALTER TABLE customer_phones ADD COLUMN IF NOT EXISTS raw_phone  TEXT    NOT NULL DEFAULT '';
ALTER TABLE customer_phones ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE customer_phones ADD COLUMN IF NOT EXISTS is_mobile  BOOLEAN NOT NULL DEFAULT false;

-- DEFAULT '' geçici; PR-8f import script raw_phone'u doldurduktan sonra
-- v5.1'de DROP DEFAULT yapılır. Mevcut row yok (MVP), pratik etki sıfır.

-- customer_id ile filtre hızlandırma (000_init.sql sadece UNIQUE).
CREATE INDEX IF NOT EXISTS idx_customer_phones_customer ON customer_phones (customer_id);

-- === 3) customer_addresses — yeni tablo ===
-- ADR-016 §11 müşteri başına çoklu adres; soft-delete (is_deleted) çünkü
-- siparişlerde adres snapshot tutulmaz, eski siparişin adresine erişilebilmeli
-- (referans için). Composite FK (id, tenant_id) — diğer tablolarla tutarlı.
CREATE TABLE customer_addresses (
  id            UUID        PRIMARY KEY,
  tenant_id     UUID        NOT NULL REFERENCES tenants(id),
  customer_id   UUID        NOT NULL,
  title         TEXT        NOT NULL DEFAULT 'Ev',
  address_line  TEXT        NOT NULL,
  district      TEXT,
  neighborhood  TEXT,
  address_note  TEXT,
  is_default    BOOLEAN     NOT NULL DEFAULT false,
  is_deleted    BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (customer_id, tenant_id) REFERENCES customers (id, tenant_id)
);

CREATE TRIGGER customer_addresses_set_updated_at
  BEFORE UPDATE ON customer_addresses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Aktif adresleri çabuk listele (silinmişler hariç).
CREATE INDEX idx_customer_addresses_customer
  ON customer_addresses (customer_id)
  WHERE is_deleted = false;

-- === 4) call_logs — yeni tablo ===
-- ADR-016 §11 Caller ID anlık çağrı log'u. Müşteri eşleşmezse customer_id NULL
-- (raw + normalized phone yine yazılır). Sipariş açılırsa opened_order_id set
-- edilir. KVKK retention (PR-8e) için received_at index zorunlu.
CREATE TABLE call_logs (
  id                UUID        PRIMARY KEY,
  tenant_id         UUID        NOT NULL REFERENCES tenants(id),
  raw_phone         TEXT,
  normalized_phone  TEXT,
  customer_id       UUID,                                 -- nullable (eşleşme yok)
  status            TEXT        NOT NULL CHECK (status IN ('ringing', 'dismissed', 'opened_order', 'completed')),
  opened_order_id   UUID,
  station_user_id   UUID,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  -- Müşteri silinirse log kalır (forensic), customer_id NULL'a düşer:
  -- composite FK (id, tenant_id) ON DELETE SET NULL (her iki kolon nullable).
  FOREIGN KEY (customer_id, tenant_id)     REFERENCES customers (id, tenant_id) ON DELETE SET NULL,
  FOREIGN KEY (opened_order_id, tenant_id) REFERENCES orders    (id, tenant_id) ON DELETE SET NULL,
  FOREIGN KEY (station_user_id, tenant_id) REFERENCES users     (id, tenant_id) ON DELETE SET NULL
);

-- Recent calls feed (DESC) — istasyon UI poll/socket reconciliation.
CREATE INDEX idx_call_logs_tenant_received ON call_logs (tenant_id, received_at DESC);
-- Telefon numarasından ara (manuel arama).
CREATE INDEX idx_call_logs_normalized      ON call_logs (normalized_phone);
-- KVKK retention cron — eski kayıtları toplu sil.
CREATE INDEX idx_call_logs_received_at     ON call_logs (received_at);

-- === 5) tenant_settings — Caller ID istasyonu + bypass pattern listesi ===
-- ADR-016 §11 Karar 11.3: tek istasyon kuralı (popup tek kullanıcıda gösterilir).
-- bypass_patterns: kurumsal hatların (şubeler arası, çağrı merkezi) sessizce
-- yutulması için regex listesi.
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS caller_id_station_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS caller_id_bypass_patterns TEXT[] NOT NULL
  DEFAULT ARRAY['^0850\d+', '^0440\d+', '^0444\d+'];
