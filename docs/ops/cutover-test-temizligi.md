# Cutover Test-Verisi Temizliği — SQL Taslağı

> **Ne zaman:** Cutover akşamı, `cutover-gunu-runbook.md` §1 adımında. **[USER kararı S98]: EVET — hard-delete + temiz başlangıç.**
> **Demir kurallar:** (1) önce **taze yedek teyidi** (runbook §0) · (2) önce **sayım + liste**, İlhan'a göster, **onay sonrası** sil · (3) silme **tek transaction** içinde · (4) sessiz `DELETE` YOK. Müşteri / menü / masa / kullanıcı KORUNUR — **korunacak tarafın sayısı sabit yazılmaz**, ADIM 0'da ölçülür (menü ve müşteri canlı düzenleniyor; 22 Tem prod: müşteri **1470** · menü **68** · masa 25).
> **`order_no` gerçeği (S98 şema-doğrulandı):** sayaç **GÜNLÜK**tür — `order_no_counters (tenant_id, business_date, last_no)`. Ayrı bir "sequence reset" GEREKMEZ: temizlikte sayaç satırları silinir, canlı ilk siparişin günü için sayaç 0'dan doğar → ilk sipariş otomatik **#1**.

Aşağıdaki bloklar prod'da `psql` ile koşulur (`:tid` = `/root/pos-secrets.env`'deki TENANT_ID). Değerleri elle yapıştırmadan önce `\set tid '<uuid>'` kullan.

## ADIM 0 — Envanter (read-only; çıktıyı İlhan'a göster)

```sql
-- Sayımlar
SELECT
  (SELECT count(*) FROM orders            WHERE tenant_id = :'tid') AS orders,
  (SELECT count(*) FROM order_items       WHERE tenant_id = :'tid') AS order_items,
  (SELECT count(*) FROM payments          WHERE tenant_id = :'tid') AS payments,
  (SELECT count(*) FROM print_jobs        WHERE tenant_id = :'tid') AS print_jobs,
  (SELECT count(*) FROM order_no_counters WHERE tenant_id = :'tid') AS no_counters,
  (SELECT count(*) FROM customers         WHERE tenant_id = :'tid') AS customers,
  (SELECT count(*) FROM products          WHERE tenant_id = :'tid') AS products;

-- Silinecek siparişlerin listesi (İlhan görsel teyit — hepsi test mi?)
SELECT order_no, order_type, status, total_cents, created_at::date
FROM orders WHERE tenant_id = :'tid' ORDER BY created_at;

-- orders'a referans veren TÜM FK'lar + SİLME KURALI (silme sırası bununla teyit
-- edilir; beklenen liste aşağıda — sapma varsa DUR, sırayı güncelle)
SELECT conname, conrelid::regclass AS referencing_table,
       CASE confdeltype WHEN 'a' THEN 'NO ACTION (ENGELLER)' WHEN 'c' THEN 'CASCADE'
                        WHEN 'n' THEN 'SET NULL' WHEN 'r' THEN 'RESTRICT (ENGELLER)'
       END AS silme_kurali
FROM pg_constraint WHERE confrelid = 'orders'::regclass ORDER BY 1;
```

**✅ 2026-07-23 (S104) prod'da ÖNCEDEN ÖLÇÜLDÜ — beklenen çıktı (5 satır):**

| FK | tablo | silme kuralı | temizlikte |
|---|---|---|---|
| `order_items_…_fkey` | `order_items` | **NO ACTION (engeller)** | `orders`'tan ÖNCE silinir ✓ |
| `payments_…_fkey` | `payments` | **NO ACTION (engeller)** | `orders`'tan ÖNCE silinir ✓ |
| `orders_merged_into_fk` | `orders` (self) | **NO ACTION (engeller)** | tek `DELETE` tüm satırları birlikte siler → sorun yok |
| `order_item_batches_…_fkey` | `order_item_batches` | CASCADE | zaten açıkça siliniyor ✓ |
| `call_logs_opened_order_fk` | `call_logs` | **SET NULL** | engellemez; çağrı geçmişi KORUNUR ✓ |

> ⚠️ **Belgedeki eski "beklenen" liste yanlıştı, düzeltildi:** (a) `call_logs` FK'si listede **yoktu** — cutover gecesi "sürpriz → DUR" kuralını tetikleyip gereksiz durdururdu; (b) `print_jobs` `orders`'a **referans vermiyor** (tenant-scoped silinir, listede yeri yok). Ölçüm anında `call_logs.opened_order_id IS NOT NULL` = **0 satır**.
>
> ⚠️ Ayrıca: `order_item_batches` CASCADE'dir ve sahibi `migrator` — sahip-DELETE yetkisi 2026-07-23'te denetlendi, **açık yok** (bkz. `deploy.md` §6 cascade istisnası; aynı sınıf bir açık `refresh_tokens`'ta canlı bug'a yol açmıştı).

**📊 2026-07-23 (S104) prod envanteri — cutover gecesi bu sayılar beklenir (o güne kadar birkaç sipariş daha eklenebilir):**

| orders | order_items | payments | print_jobs | order_no_counters |
|---|---|---|---|---|
| 119 | 297 | 89 | 252 | 16 |

Silinmeyecekler (teyit): **müşteri 1475** · **ürün 68** · **masa 35** (hepsi aktif, tek bölge `SALON`).

## ADIM 1 — Hard-delete (tek transaction; onaydan SONRA)

```sql
BEGIN;
  DELETE FROM print_jobs             WHERE tenant_id = :'tid';
  DELETE FROM payment_items          WHERE tenant_id = :'tid';
  DELETE FROM payments               WHERE tenant_id = :'tid';
  DELETE FROM order_item_attributes  WHERE tenant_id = :'tid';
  DELETE FROM order_items            WHERE tenant_id = :'tid';
  DELETE FROM order_item_batches     WHERE tenant_id = :'tid';
  DELETE FROM orders                 WHERE tenant_id = :'tid';
  DELETE FROM order_no_counters      WHERE tenant_id = :'tid';
-- Sayımlar beklenene uyuyorsa: COMMIT; uymuyorsa: ROLLBACK;
```

> `COMMIT` öncesi aynı tx içinde ADIM 2 sayımlarını koş — beklenmedik satır sayısı görürsen `ROLLBACK` de ve dur.

## ADIM 2 — Doğrulama (COMMIT öncesi tx-içi + COMMIT sonrası tekrar)

```sql
SELECT
  (SELECT count(*) FROM orders            WHERE tenant_id = :'tid') AS orders,        -- 0
  (SELECT count(*) FROM payments          WHERE tenant_id = :'tid') AS payments,      -- 0
  (SELECT count(*) FROM print_jobs        WHERE tenant_id = :'tid') AS print_jobs,    -- 0
  (SELECT count(*) FROM order_no_counters WHERE tenant_id = :'tid') AS no_counters,   -- 0
  (SELECT count(*) FROM customers         WHERE tenant_id = :'tid') AS customers,     -- ADIM 0'daki sayının AYNISI (22 Tem: 1470)
  (SELECT count(*) FROM products          WHERE tenant_id = :'tid') AS products;      -- ADIM 0'daki sayının AYNISI (22 Tem: 68)
```

## ADIM 3 — Audit kayıtları (OPSİYONEL — cutover günü İlhan kararı)

Test-dönemi `audit_logs` kayıtları **varsayılan olarak KORUNUR** (denetim-izi geçmişi; sipariş satırlarına FK yok, öksüz kalmaları zararsız). İlhan "onlar da silinsin" derse:

```sql
-- Yalnız açık onayla:
DELETE FROM audit_logs WHERE tenant_id = :'tid';
```

## Kapsam-dışı (bilinçli)

- `call_logs` (Caller ID geçmişi) — sipariş zincirinden bağımsız, KVKK saklama-süresi ayrı yönetilir; bu temizliğin konusu DEĞİL.
- Menü/masa/kullanıcı/müşteri tabloları — DOKUNULMAZ.

## Geri dönüş

Yanlış silme fark edilirse: `docs/ops/backup-strategy.md` restore reçetesi (gece yedeği + off-site `.age`). Temizlik zaten yedek-teyidi ön-koşuluyla başlar.
