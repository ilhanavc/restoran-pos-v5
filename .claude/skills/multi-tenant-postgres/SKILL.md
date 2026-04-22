---
name: multi-tenant-postgres
description: Use when designing, migrating, or querying the multi-tenant PostgreSQL database. Covers tenant_id column convention, Row Level Security (RLS) policies, cross-tenant isolation testing, and migration safety.
---

# Multi-Tenant PostgreSQL

> **v5 notu**: MVP'de tek tenant (ID: 1) var. Ama DB şeması ve kod **çoklu tenant'a hazır** olarak yazılır. Bu şekilde v5.1'de multi-tenant açılması 2-3 gün işe düşer, 2-3 hafta değil. Aşağıdaki tüm ilkeler MVP'de uygulanır; farkı yalnızca fiiliyatta tek tenant değerinin kullanılmasıdır.
>
> v5 MVP'de **Branch yok** — tek şube. `branch_id` kolonu şimdilik eklenmez; v5.2'de eklenecekse yeni migration'la gelir.

Bu proje shared DB + tenant_id pattern'ini Row Level Security (RLS) ile birleştirir. Her satır `tenant_id` ile sahiplendirilir, policy'ler cross-tenant erişimi engeller.

## Tenant hiyerarşisi

```
Tenant (ödeme yapan işletme — örn: "İlhan'ın Restoranı")
  ├── Users (admin, cashier, waiter, kitchen)
  ├── Tables
  ├── Menu
  ├── Orders
  └── Payments
```

- **Tenant**: En üst seviye, faturalama/ayar birimi
- **User**: Tenant'a ait, role field'ı ile yetki alır
- **Branch**: v5.0'da YOK. v5.2+'da eklenmesi muhtemel.

## Tablo konvansiyonu

Her transactional tablo:

```sql
CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  branch_id       UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  table_id        UUID REFERENCES tables(id),
  status          order_status NOT NULL,
  total_kurus     BIGINT NOT NULL CHECK (total_kurus >= 0),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  version         INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT orders_branch_belongs_to_tenant CHECK (
    -- Database-level consistency: branch'ın tenant'ı ile order'ın tenant'ı eşleşmeli
    -- Uygulamada trigger ile valide edilir
    branch_id IS NOT NULL
  )
);

CREATE INDEX idx_orders_tenant_branch ON orders (tenant_id, branch_id);
CREATE INDEX idx_orders_tenant_status ON orders (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_updated_at ON orders (updated_at); -- sync cursor için
```

### Ortak kolonlar (her tabloda)
- `id` UUID PK
- `tenant_id` UUID NOT NULL — izolasyon anahtarı
- `created_at`, `updated_at` — audit
- `deleted_at` — soft delete (tombstone for sync)
- `version` — optimistic locking

## Row Level Security (RLS)

RLS ile uygulama katmanı bir bug yapsa bile cross-tenant veri sızıntısı olmaz.

### Setup

```sql
-- Her tablo için
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;

-- Policy
CREATE POLICY orders_tenant_isolation ON orders
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE POLICY orders_tenant_isolation_insert ON orders
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### Uygulama katmanı — connection setup

```typescript
// Her request başında tenant context ayarla
import { Pool, PoolClient } from 'pg';

async function withTenant<T>(
  pool: Pool,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SET app.current_tenant_id = $1', [tenantId]);
    return await fn(client);
  } finally {
    await client.query('RESET app.current_tenant_id');
    client.release();
  }
}

// Kullanım
await withTenant(pool, req.user.tenantId, async (client) => {
  const result = await client.query('SELECT * FROM orders WHERE status = $1', ['open']);
  return result.rows;
});
```

### Super-admin bypass (rapor, migration için)

```sql
-- Role bazlı bypass
CREATE ROLE app_user;
CREATE ROLE app_superadmin;

-- Normal user RLS'e tabi
-- Superadmin BYPASS RLS
ALTER ROLE app_superadmin BYPASSRLS;
```

Production uygulaması `app_user` rolüyle bağlanır. Migration ve support tool'ları `app_superadmin` rolüyle.

## Tenant context kaybolma tehlikesi

En büyük risk: `current_setting` boş olunca RLS tüm satırları görür (policy `USING` clause fail). Bunu önlemek için:

```sql
-- Policy'yi strict yap
CREATE POLICY orders_tenant_isolation ON orders
  USING (
    tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::UUID
  );

-- current_setting boşsa hiçbir satır görünmez (UUID cast NULL döndürür)
```

Her controller/middleware'de assertion:

```typescript
// Middleware
app.use(async (req, res, next) => {
  if (!req.user?.tenantId) {
    return res.status(401).json({ error: 'no_tenant' });
  }
  req.tenantId = req.user.tenantId;
  next();
});
```

## Test: cross-tenant isolation

Her yeni tablo için otomatik test:

```typescript
describe('multi-tenancy', () => {
  it('prevents reading other tenant orders', async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();

    const orderA = await createOrder(tenantA.id, { status: 'open' });
    const orderB = await createOrder(tenantB.id, { status: 'open' });

    await withTenant(pool, tenantA.id, async (client) => {
      const result = await client.query('SELECT id FROM orders');
      const ids = result.rows.map(r => r.id);

      expect(ids).toContain(orderA.id);
      expect(ids).not.toContain(orderB.id);
    });
  });

  it('prevents inserting order into other tenant', async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();

    await withTenant(pool, tenantA.id, async (client) => {
      await expect(
        client.query(
          'INSERT INTO orders (tenant_id, branch_id, status, total_kurus) VALUES ($1, $2, $3, $4)',
          [tenantB.id, /* ... */]
        )
      ).rejects.toThrow(/policy/i);
    });
  });
});
```

## Migration patterns

### Yeni tablo eklerken

```sql
-- 1. Tablo oluştur
CREATE TABLE new_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  -- ... diğer kolonlar
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Index
CREATE INDEX idx_new_table_tenant ON new_table (tenant_id);

-- 3. RLS
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;
ALTER TABLE new_table FORCE ROW LEVEL SECURITY;

CREATE POLICY new_table_tenant_isolation ON new_table
  USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::UUID);

-- 4. Trigger: updated_at otomatik
CREATE TRIGGER trg_new_table_updated_at
  BEFORE UPDATE ON new_table
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
```

## Performance

Her query mutlaka `tenant_id` ile filtre. Yoksa:
- Tam tablo taraması
- Index etkisiz
- RLS runtime overhead çok yüksek

**Query plan control**: production'da yavaş query'ler için `EXPLAIN ANALYZE` çıktısı `pg_stat_statements` ile izlenir.

## Tenant silme

Tenant silmek kademeli süreç:

1. Subscription cancel (faturalama durdu)
2. 30 gün grace period — restore mümkün
3. 30 gün sonra: hard delete
   - Önce bağlı verileri: orders, customers, menu, vb.
   - Son tenant satırı
4. Backup'larda 90 gün daha saklanır, sonra incremental purge

## Cross-tenant veri analizi (aggregate)

SaaS platform seviyesinde istatistik için:

```sql
-- Superadmin rolüyle
SET ROLE app_superadmin;

SELECT
  COUNT(DISTINCT tenant_id) AS active_tenants,
  COUNT(DISTINCT branch_id) AS total_branches,
  DATE_TRUNC('day', created_at) AS day,
  COUNT(*) AS orders
FROM orders
WHERE created_at > NOW() - INTERVAL '30 days'
  AND deleted_at IS NULL
GROUP BY day
ORDER BY day;
```

Bu tarz query'ler asla application context'inde çalışmaz.

## Yasaklar

- ❌ Tenant context olmadan query çalıştırmak
- ❌ `tenant_id` kolonu olmayan yeni tablo eklemek (intermediate tablolar hariç)
- ❌ Cross-tenant JOIN (RLS bunu zaten engeller, ama yazmak bile hata göstergesi)
- ❌ `app_user` dışında bir role ile application bağlantısı
- ❌ RLS policy'siz tablo deploy etmek
