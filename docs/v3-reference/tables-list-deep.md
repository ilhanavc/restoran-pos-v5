# v3 Tables List + Dolu Masa Kartı — Derin Keşif

**Kapsam:** v3 (`D:\dev\restoran-pos-v3`) `TablesScreen.jsx` dolu kart davranışı + backend `GET /api/tables` projection. v5 PR-11 (Masalar listesi dolu state) için referans.

**Statü:** Session 49+ Explore sub-agent çıktısı (2026-05-02). Kapsam dar — yalnız tables list / kart durum skalası / ⋮ menü / paket panel.

---

## A. Frontend — Kart Layout

### A1. Genel ölçüler
- `height: 180px`
- `padding: 22px`
- `border: 1.5px solid`
- `borderRadius: var(--radius-md)`
- `box-shadow: var(--shadow-soft)`
- Grid: `repeat(3, minmax(0, 1fr))`, `gridAutoRows: 180`, `gap: 18`
- File: `TablesScreen.jsx:645-715`

### A2. 5-Durum Renk Skalası (kritik)

`occupiedMinutes = (now - parseDbTimestampMs(order_started_at)) / 60000`

| Koşul | borderColor | bg |
|---|---|---|
| Transfer kaynağı | `var(--info)` | `var(--info-muted)` |
| **isPaid** (tamamen ödendi) | `var(--success)` | `var(--success-muted)` |
| **hasReady** (hazır kalem var) | `var(--success)` | `var(--success-muted)` |
| **occupiedMinutes > 60** | `var(--danger)` | `var(--danger-muted)` |
| Normal dolu (0-60 dk) | `var(--warning)` | `var(--warning-muted)` |

Reserved durumda kart bg `var(--bg-card)` (boş gibi), border `st.color + '40'` (mor %25 opasite), ⋮ menü yok.

File: `TablesScreen.jsx:668-692`.

**v5 implications:** `var(--warning) = #f59e0b`, `var(--danger) = #dc2626`, `var(--success) = #10b981` (v3 token'ları v5 theme'inde aynı eşleşme). 5-durum mantığı `TableCard.tsx`'te uygulanmalı.

### A3. Üst-sağ köşe rozet/dot mantığı

| Durum | Render |
|---|---|
| `isPaid` | "HESAP ÖDENDİ" rozet (yeşil bg, beyaz text, 10px/700, 2/7px padding, 6px radius) |
| `!isPaid && hasReady` | "HAZIR" rozet (yeşil bg + `animation: pulse 2s infinite`) |
| Diğer | 8×8px dot (status'a göre — boş yeşil, dolu sarı, rezerve mor) |
| `isOccupied && !isReserved && !transferMode` | `<MoreVertical size={18} />` kebab buton |

File: `TablesScreen.jsx:748-793`.

### A4. Kart içerik alanları (dolu)

| Alan | Stil |
|---|---|
| Başlık (`displayName`) | 24px, 800, letter-spacing -0.02em, line-height 1.15 |
| Waiter adı (`table.waiter_name`) | 11px, `var(--text-muted)`, mb 4 — yalnız `isOccupied && waiter_name` ise |
| Tutar (`formatCurrency(order_total)`) | 22px, 800, `var(--text-primary)` |
| Kısmi ödeme ek (`/₺X,XX`) | 18px, `var(--success)` — yalnız `order_paid_total > 0` ise |
| Süre (`formatOrderElapsed`) | 10px, `var(--text-muted)`, `<Clock size={10} />` ikon |
| Misafir sayısı | 10px, aynı stil |

File: `TablesScreen.jsx:737-843`.

### A5. `formatOrderElapsed` (frontend hesap)

Backend ham UTC string döndürür; format frontend'de:

```
< 1 saat   → "X dk Y sn"
1-24 saat  → "X sa Y dk Z sn"
24+ saat   → "X gün Y sa Z dk W sn"
```

`parseDbTimestampMs(dateStr)` utility v5'e taşınmalı. File: `TablesScreen.jsx:1-25`.

### A6. ⋮ Kebab Menü Aksiyonları

`openMenuTableId` state ile açılır:

| Action | Handler | Koşul |
|---|---|---|
| `payment` | `onPayment(order)` | her dolu masa |
| `quick-payment` | `onQuickPayment(order)` | her dolu masa |
| `close-paid-table` | `api.updateOrderStatus(orderId, 'closed')` | yalnız `isPaid` |
| `cancel` | confirm dialog → `updateOrderStatus(id, 'cancelled')` | her dolu masa |
| `print` | `ManualPrintSelectorModal` | her dolu masa |
| `transfer` | `setTransferMode(table.id)` | her dolu masa |

Rol kısıtlaması: backend `tableStaff = authorize('admin', 'cashier', 'waiter')`. **Frontend rol bazlı ayrım YOK** — tüm aksiyonlar tüm rollere görünür. File: `TablesScreen.jsx:340-430, 780-793`.

### A7. Bölge sekmesi kart sayısı

Tab label: `{area.name} ({occupied}/{total})` — `occupied = filter(t => t.status === 'occupied').length`. Opacity 0.6 dim. File: `TablesScreen.jsx:630-638`.

### A8. Paket butonu

`btn-ghost tables-paket-btn`, `<Package size={18} />`. Active state CSS class bazlı (`showTakeawaySidebar` prop). File: `TablesScreen.jsx:568-575`.

### A9. Paket Siparişler Sağ Panel

`width: 340, background: var(--bg-secondary), borderLeft 1px solid var(--border), padding 16, overflowY auto`. Başlık 13px/700. Kart border `var(--info)` (teslimatta) veya `var(--border)` (bekliyor). Durum rozeti: "Teslimatta" (info) / "Hazırlanıyor" (warning). File: `TablesScreen.jsx:851-870`.

### A10. Realtime events

Subscribe: `['table:updated', 'table:transferred', 'order:created', 'order:updated', 'order:takeaway_delivery']` — hepsi `loadTables() + loadTakeaway() + loadPrintHealth()` tetikler (full refetch, diff yok). File: `TablesScreen.jsx:128-136`.

---

## B. Backend — `GET /api/tables` Projection

### B1. SQL query yapısı

```sql
SELECT t.*,
  -- order_total: aktif siparişin grand_total'u
  CASE WHEN t.current_order_id IS NOT NULL THEN
    (SELECT grand_total FROM orders WHERE id = t.current_order_id)
  ELSE 0 END as order_total,
  -- order_paid_total: o ana kadar yapılmış ödemeler toplamı (partial)
  CASE WHEN t.current_order_id IS NOT NULL THEN
    (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE order_id = t.current_order_id)
  ELSE 0 END as order_paid_total,
  -- order_started_at: orders.created_at (UTC string)
  CASE WHEN t.current_order_id IS NOT NULL THEN
    (SELECT created_at FROM orders WHERE id = t.current_order_id)
  ELSE NULL END as order_started_at,
  -- waiter_name: orders → users (v3 users.full_name; v5 users.username)
  (SELECT u.full_name FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    WHERE o.id = t.current_order_id) as waiter_name,
  -- order_line_count: cancelled olmayan kalem sayısı
  CASE WHEN t.current_order_id IS NOT NULL THEN
    (SELECT COUNT(*) FROM order_items oi
      WHERE oi.order_id = t.current_order_id AND oi.status != 'cancelled')
  ELSE 0 END as order_line_count,
  -- has_ready_items: EXISTS subquery
  CASE WHEN t.current_order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM order_items oi
    WHERE oi.order_id = t.current_order_id AND oi.status = 'ready'
  ) THEN 1 ELSE 0 END as has_ready_items
FROM tables t
WHERE t.business_id = ? AND t.is_active = 1
ORDER BY t.sort_order
```

File: `server/routes/tables.js:29-70`.

### B2. Kritik notlar

| Alan | Kural |
|---|---|
| `waiter_name` | v3: `users.full_name`. v5'te `users.username` (v5 schema farkı — v5 PR-11'de username kullanılacak) |
| `has_ready_items` | `EXISTS (... WHERE status='ready')` → integer 0/1 döner. Frontend `Number(...)===1` kontrolü |
| `order_started_at` | `orders.created_at` UTC string — ayrı kolon değil |
| `order_total` vs `order_paid_total` | Farklılarsa partial payment → kartta `/₺X` ek gösterim |
| Status enum | YALNIZ `'empty'`, `'occupied'`, `'reserved'`. `paid`/`cleaning` YOK. `isPaid` derived (frontend `paid_total >= total`) |

### B3. PATCH /api/tables/:id/status

- Body: `{ status: 'empty' | 'occupied' | 'reserved' }`
- Guard: `occupied` → `current_order_id` zorunlu (400)
- Guard: `empty/reserved` → `current_order_id` olmamalı (400)
- Rol: `tableStaff` (admin + cashier + waiter)
- Socket: `table:updated` emit

### B4. Transfer atomicity (önceki keşfin doğrulanması)

`db.transaction()` içinde: orders.table_id update + hedef table state kopya + source empty. Tek atomik işlem. `table:transferred` emit. File: `server/routes/tables.js:108-145`.

---

## C. v5 Mevcut Durum (Gap Analizi)

### C1. v5 backend `apps/api/src/routes/tables.ts` + `repo`

- `GET /tables` → temel kolonlar (`id, tenant_id, code, capacity, area_id, status, deleted_at, created_at, updated_at`)
- **Eksik (v3'te var):** `order_total`, `order_paid_total`, `order_started_at`, `waiter_name`, `has_ready_items`, `guest_count`, `order_line_count`
- v5 `repo.findAll` Kysely query'sine subquery projection eklenmeli (PR-11)

### C2. v5 frontend `ApiTable` (zaten Phase 3+ yorumlu opsiyonel alanlar)

`apps/web/src/features/tables/api.ts:24-29` — alanlar zaten var ama "her zaman undefined" notu kaldırılacak.

---

## D. v5 PR-11 Backend Amendment Listesi

PR-11'de `TableCard.tsx`'e dolu state uygulamak için v5 backend'de:

1. **`tablesRepository.findAll`** Kysely query genişletme:
   - `orders.total_cents as order_total_cents` (subquery)
   - `(SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE order_id = ...) as order_paid_total_cents`
   - `orders.created_at as order_started_at` (subquery)
   - `users.username as waiter_name` (LEFT JOIN, v5 schema)
   - `EXISTS (...status='ready') as has_ready_items` (BOOLEAN PostgreSQL)
   - `(SELECT COUNT(*) FROM order_items WHERE order_id = ... AND status != 'cancelled') as order_line_count`

2. **`tables` tablosu eksiği:** `current_order_id` kolonu var mı? v3'te `tables.current_order_id` aktif kullanılıyor. v5'te yoksa Migration 020 gerekir veya `orders` tablosundan `WHERE table_id = t.id AND status='open'` ile join.

3. **`ApiTable` interface:** Phase 3+ yorum kaldırılır, alanlar zorunlu.

4. **Frontend `TableCard.tsx`:** 5-durum renk skalası, "HAZIR/HESAP ÖDENDİ" rozeti, ⋮ kebab menü, `formatOrderElapsed` utility, `parseDbTimestampMs` utility.

5. **Realtime:** `useSocketEvent('table:updated', invalidate)` — mevcut hook genişletilir; `order:created/updated`, `payment:created` event'leri eklenir.

---

## Cross-ref

- ADR-013 §5 (actor rozeti — orders.user_id → username)
- ADR-009 (Areas — bölge sekmesi 1/25 sayım)
- ADR-010 (Socket.IO realtime)
- v3 dosyalar: `client/src/components/tables/TablesScreen.jsx`, `server/routes/tables.js`
- v5 mevcut: `apps/web/src/features/tables/{TablesListPage,TableCard}.tsx`, `apps/api/src/routes/tables.ts`, `apps/web/src/features/tables/api.ts`
