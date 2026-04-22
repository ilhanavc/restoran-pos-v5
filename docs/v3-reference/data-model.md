# v3 Veri Modeli Notları (v5 Şema İlkeleri)

> v3 SQLite şemasından çıkarılan **veri modelleme dersleri**. v5 PostgreSQL 17 + tenant_id şemasına taşınacak kurallar. Kod değil, tablo/kolon/index kararları.

## Para Tipleri — Tek Kural

- **Tüm para kolonları `INTEGER` (kuruş / minor unit)** isim: `*_cents`.
- `NUMERIC`, `DECIMAL`, `REAL`, `FLOAT` **yasak**.
- v3'te çift saklama vardı (`grand_total` REAL + `grand_total_cents` INT). v5'te tek kolon.
- Raporlarda `COALESCE(x.amount_cents, ROUND(x.amount * 100))` pattern'i v3'te çirkindi → v5'te gereksiz (Sinyal #21).

## Primary Key

- **UUID v7** (ADR-003'te karara bağlanacak). Zamansal sıralı, index dostu.
- v3'te INTEGER AUTOINCREMENT vardı — multi-tenant + cloud için UUID gerekli.

## Multi-Tenant

- Her business-scoped tabloda `tenant_id UUID NOT NULL` + FK.
- Tüm unique/partial index'ler `tenant_id` öneki ile: `UNIQUE(tenant_id, …)`.
- v5.0'da tek tenant (kendi restoran), v5.1+ 2-3 işletme daha. Şema multi-tenant hazır, RLS sonradan eklenebilir.

## Timestamp

- **`TIMESTAMPTZ`** (UTC store, TZ aware).
- Her tabloda `created_at`, `updated_at` DEFAULT `now()`.
- `store_date(created_at)` fonksiyonu: İşletme TZ'de (Europe/Istanbul) günü döner — `order_no` günlük reset + raporlar için.

## Snapshot Kolonları (Değişmezlik)

v3'ten korunacak pattern. Domain-rules.md'de tam liste.

| Tablo | Snapshot Kolonları |
|---|---|
| `order_items` | `product_name`, `unit_price_cents`, `category_id_snapshot`, `category_name_snapshot` |
| `orders` | `customer_name_snapshot`, `address_snapshot`, `table_name_snapshot` |
| `call_logs` | `customer_name_snapshot`, `address_snapshot` |

Rapor `GROUP BY` hep snapshot üzerinden (Sinyal #6, #35).

## Önemli UNIQUE/Partial Index'ler

### Tek masa = tek aktif sipariş
```sql
CREATE UNIQUE INDEX orders_active_table
  ON orders(tenant_id, table_id)
  WHERE status = 'open';
```

### Telefon tekilliği (Caller ID eşleşmesi net)
```sql
CREATE UNIQUE INDEX customer_phones_normalized
  ON customer_phones(tenant_id, normalized_phone);
```
v3'te yoktu → aynı müşteri birden çok kayıt olabiliyordu (Sinyal #14).

### Order no günlük tekilliği
```sql
CREATE UNIQUE INDEX orders_daily_no
  ON orders(tenant_id, store_date(created_at), order_no);
```
Günlük reset için (Sinyal #23).

### Print job idempotency
```sql
CREATE UNIQUE INDEX print_jobs_idempotency
  ON print_jobs(tenant_id, idempotency_key);
```

## Soft vs Hard Delete (Sinyal #7)

- Referans varsa soft-delete (`deleted_at TIMESTAMPTZ NULL`).
- Hiç referans yoksa hard-delete.
- `shared-domain/canHardDelete(entity)` karar veriyor.
- Örnek: hiç satılmamış `products` → hard delete + image cleanup. Satılan ürün → soft (rapor bütünlüğü).

## Enum Tipleri (PostgreSQL native)

```sql
CREATE TYPE order_status AS ENUM ('open', 'preparing', 'served', 'closed', 'cancelled');
CREATE TYPE order_type   AS ENUM ('dine_in', 'takeaway');
CREATE TYPE payment_type AS ENUM ('cash', 'card');       -- mixed, other deprecated (Sinyal #29)
CREATE TYPE payment_scope AS ENUM ('full_order', 'split_item');
CREATE TYPE print_job_type AS ENUM ('receipt', 'kitchen', 'kitchen_adjustment', 'label');
CREATE TYPE print_job_status AS ENUM ('queued', 'printing', 'printed', 'failed');
CREATE TYPE user_role AS ENUM ('admin', 'cashier', 'waiter', 'kitchen');
```

## Kritik Tablolar (şema iskeleti)

### orders
```
id UUID v7 PK
tenant_id UUID FK
order_no INT                    -- günlük reset
order_type order_type
status order_status
table_id UUID FK NULL           -- takeaway'de null
assigned_waiter_id UUID NULL
customer_id UUID FK NULL
customer_name_snapshot TEXT NULL
address_snapshot JSONB NULL
table_name_snapshot TEXT NULL
subtotal_cents INT
tax_cents INT
grand_total_cents INT
created_by UUID FK users
created_at TIMESTAMPTZ
```

### order_items
```
id UUID PK
order_id UUID FK
product_id UUID FK
product_name TEXT              -- snapshot
portion_id UUID FK
unit_price_cents INT           -- snapshot
quantity NUMERIC(10,3)         -- kg/porsiyon
category_id_snapshot UUID
category_name_snapshot TEXT
is_comped BOOLEAN DEFAULT false
comp_reason TEXT NULL
sent_to_kitchen_at TIMESTAMPTZ NULL
adjusted_from_item_id UUID NULL  -- adjustment trail
```

### payments
```
id UUID PK
order_id UUID FK
payment_type payment_type      -- cash | card
payment_scope payment_scope
amount_cents INT
tendered_cents INT NULL        -- nakitte zorunlu
discount_amount_cents INT DEFAULT 0  -- MVP always 0, v5.1'de kullanılır
idempotency_key TEXT UNIQUE
processed_by UUID FK users
created_at TIMESTAMPTZ
```

### refunds (Sinyal #31, yeni)
```
id UUID PK
order_id UUID FK
amount_cents INT
reason TEXT NOT NULL
approved_by UUID FK users
created_at TIMESTAMPTZ
```

### customers + customer_phones
```
customers: id, tenant_id, full_name, notes, created_at, anonymized_at
customer_phones: id, customer_id, phone_raw, normalized_phone, created_at
  UNIQUE(tenant_id, normalized_phone)
customer_addresses: id, customer_id, address_text, district, notes
```

Anonimize modeli (Sinyal #15): silme yok, `full_name='Anonim'` + telefon/adres silinir.

### call_logs (Sinyal #20, legacy `incoming_calls` kaldırılır)
```
id, tenant_id, phone_raw, normalized_phone,
customer_id FK NULL, customer_name_snapshot, address_snapshot,
called_at TIMESTAMPTZ
-- 30 gün retention, cron ile purge
```

### period_closes (Sinyal #33, Modül 11)
```
id, tenant_id,
period_start TIMESTAMPTZ, period_end TIMESTAMPTZ,
store_date DATE,
totals JSONB,                -- {cash, card, items_sold, comps, refunds, ...}
open_orders_count INT,       -- kapanışta açık sayısı (bilgi)
closed_at TIMESTAMPTZ,
closed_by UUID FK users,
overridden_at TIMESTAMPTZ NULL,
overridden_by UUID FK NULL,
override_reason TEXT NULL
```

### audit_logs (Sinyal #39, #40)
```
id, tenant_id,
event_type TEXT,              -- order.cancel, payment.create, ...
actor_user_id UUID FK,
user_agent TEXT NULL,
entity_type TEXT, entity_id UUID,
payload JSONB,                -- PII sanitize edilmiş
created_at TIMESTAMPTZ
-- 2 yıl retention, cron ile purge
-- IP yok (KVKK)
```

### print_jobs
```
id, tenant_id, order_id NULL, printer_id FK,
job_type print_job_type,
payload_bytes BYTEA,          -- ESC/POS encoded
status print_job_status,
attempts INT DEFAULT 0,
idempotency_key TEXT UNIQUE,
last_error TEXT NULL,
enqueued_at, printed_at NULL
```

### printers (Sinyal #27)
```
id, tenant_id, name, type (receipt|kitchen|bar|label),
connection JSONB,             -- {kind: 'usb'|'tcp', ...}
paper_width INT,              -- 58 veya 80
active BOOLEAN
```

## Migration Tool

ADR-003'te karara bağlanacak. Adaylar: `drizzle-kit`, `kysely + kysely-migrate`, `node-pg-migrate`. Her migration idempotent + reversible + `db-migration-guard` onayı.

## v3'te Gözlenen Şema Ağrıları (v5'te kaçınılacak)

- **Çift para saklama** (REAL + INT cents): v5'te sadece `_cents INT`.
- **Phone UNIQUE eksik**: v3 Caller ID eşleşme belirsizdi → v5'te partial unique zorunlu.
- **Audit retention yok**: v3'te audit büyük oldu → v5'te 2 yıl cron.
- **`incoming_calls` + `call_logs` iki tablo**: v3'te tutarsız → v5'te yalnız `call_logs`.
- **Global `AUTOINCREMENT` PK**: multi-tenant'a uygun değil → UUID v7.
- **Snapshot kolonları opsiyoneldi**: v5'te zorunlu (`NOT NULL` siparişte).
- **Kategori `category_id_snapshot` v3'te vardı** (Sinyal #35): v5'te korunacak, ilham alınacak.
