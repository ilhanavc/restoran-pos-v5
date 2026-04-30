# Sprint 8c — Web Menu + Tanımlamalar (admin CRUD)

- **Branch:** `feat/web-menu-sprint-8c`
- **Worktree:** `D:\restoran-pos-v5\.claude\worktrees\frosty-greider-6acb25`
- **Kapsam:** Seçenek B — Menü ekranı + Tanımlamalar admin (kategori/ürün/areas/masalar CRUD) + `area_id` exposure
- **MVP scope-guard:** ✓ v3'te `MenuScreen.jsx` + Tanımlamalar var; v5.0 MVP içinde
- **Yeni ADR gerekli mi?** Hayır. ADR-009 (areas) + ADR-011 (UI stack) + ADR-002 (RBAC) yeterli. Yalnız ADR-003 §14.2.B `area_id` projection minor genişleme — ADR-009 §Karar 4 zaten kapsıyor.

## Backend boşluk tespiti (sub-agent doğrulaması)

| Konu | Durum | Eylem |
|---|---|---|
| `GET /tables` response → `area_id` | **EKSİK**. `tablesRepo.baseQuery` `area_id`'yi select etmiyor; `TableWithStatus` tipinde yok | PR #1: repo select + interface + route response (writes audit yok, salt projection) |
| `apps/web/src/features/tables/api.ts` `ApiTable.area_id` | **EKSİK** (yorumda da kabul edilmiş, "Sprint 8c'de") | PR #1 ile birlikte |
| `GET /menu/categories` | Var (Sprint 4) | — |
| `GET /menu/products` | Var (Sprint 3b) | — |
| `POST/PATCH/DELETE /menu/categories` | Var | — |
| `POST/PATCH/DELETE /menu/products` | Var | — |
| `/areas` REST CRUD | Var (Sprint 5, ADR-009) | — |
| `POST/PATCH/DELETE /tables` + `PATCH /tables/:id/area` | Var | — |

Backend'de **tek değişiklik = `area_id` exposure** (PR #1). Geri kalan PR'lar tamamı web-only.

## PR planı (atomik, ≤500 satır)

### PR #1 — Backend: `area_id` exposure on GET /tables  [BLOCKER]
- **Amaç:** `tables` listesi `area_id` field'ını döndürsün; Sprint 8b tab badges (`İç Salon (n/N)`, `BAHÇE (n/N)`) aktif olsun.
- **Dosyalar:** `packages/db/src/repositories/tables.ts` (baseQuery select + `TableWithStatus`), `apps/api/src/routes/tables.ts` (response zaten generic), `apps/web/src/features/tables/api.ts` (`ApiTable.area_id`), `apps/web/src/features/tables/.../TablesScreen.tsx` (badge filter aktivasyonu), shared-types `TableRow` schema güncellemesi.
- **DoD:** repo unit test yeşil, integration `area_id` döner, web tab badges gerçek sayıları gösterir, contract test güncel, hci-reviewer onayı.
- **Bağımlılık:** yok. Diğer PR'lar buna dayanır.
- **Tahmini boy:** ~150 satır.

### PR #2 — Web: Menu screen (görünüm)
- **Amaç:** v3 paritesi salt-okunur menü ekranı — sol kategori paneli + sağ ürün grid. `/menu` route aktif.
- **Dosyalar:** `apps/web/src/features/menu/{api.ts, MenuScreen.tsx, components/CategoryList.tsx, ProductGrid.tsx, ProductCard.tsx}`, router, sidebar `disabled=false`, i18n `menu.*` keys.
- **DoD:** v3 görsel paritesi (referans `MenuScreen.jsx`), TanStack Query `/menu/categories` + `/menu/products`, kategori filtresi, fiyat TL formatı, hci-reviewer + turkish-ux-reviewer onayı, Türkçe i18n keys.
- **Bağımlılık:** yok (PR #1'den bağımsız).
- **Tahmini boy:** ~350 satır.

### PR #3 — Web: Tanımlamalar shell + Areas CRUD
- **Amaç:** `/tables` (Tanımlamalar) admin sayfa iskeleti — sol tab (Bölgeler / Masalar / Kategoriler / Ürünler) + ilk modül areas CRUD.
- **Dosyalar:** `apps/web/src/features/admin/{AdminLayout.tsx, AdminTabs.tsx, areas/{api.ts, AreasPanel.tsx, AreaFormDialog.tsx, AreaDeleteDialog.tsx}}`, router guard `admin` rolü, i18n.
- **DoD:** RBAC guard (admin-only, başka rol → 403 redirect), CRUD mutations TanStack + zod RHF, optimistic invalidate, dialog focus-trap, AREA_NOT_FOUND hata mesajı Türkçe, Definition of Done.
- **Bağımlılık:** yok.
- **Tahmini boy:** ~450 satır.

### PR #4 — Web: Tanımlamalar > Masalar CRUD + area atama
- **Amaç:** Masa ekle/düzenle/sil + `PATCH /tables/:id/area` ile bölgeye atama.
- **Dosyalar:** `apps/web/src/features/admin/tables/{api.ts (admin hooks), TablesPanel.tsx, TableFormDialog.tsx, TableAreaSelect.tsx, TableDeleteDialog.tsx}`.
- **DoD:** TABLE_ALREADY_OCCUPIED 409 → "Aktif siparişi olan masa silinemez" Türkçe toast, `area_id: null` ile bölgeden çıkar, optimistic UI, qa unit test, hci-reviewer.
- **Bağımlılık:** PR #1 (`area_id` field), PR #3 (admin shell).
- **Tahmini boy:** ~400 satır.

### PR #5 — Web: Tanımlamalar > Kategoriler CRUD
- **Amaç:** Menü kategorisi admin CRUD (ad, sıra, renk varsa).
- **Dosyalar:** `apps/web/src/features/admin/categories/{api.ts, CategoriesPanel.tsx, CategoryFormDialog.tsx, CategoryDeleteDialog.tsx}`.
- **DoD:** Sıralama (sort_order) drag yerine number input MVP, soft delete teyidi, Menu screen invalidate, i18n.
- **Bağımlılık:** PR #3 (admin shell).
- **Tahmini boy:** ~350 satır.

### PR #6 — Web: Tanımlamalar > Ürünler CRUD
- **Amaç:** Menü ürünü admin CRUD (ad, kategori, fiyat kuruş, açıklama, aktiflik).
- **Dosyalar:** `apps/web/src/features/admin/products/{api.ts, ProductsPanel.tsx, ProductFormDialog.tsx, ProductDeleteDialog.tsx, PriceInput.tsx}`.
- **DoD:** Fiyat **integer minor unit (kuruş)** — float yasak (anayasa); kategori dropdown PR #5 sonrası dolu; Menu screen invalidate; qa test fiyat round-trip.
- **Bağımlılık:** PR #3, PR #5 (kategori dropdown).
- **Tahmini boy:** ~450 satır.

## Sıra ve paralelleşme

```
PR#1 (backend area_id)  ─┐
                         ├─→ PR#4 (admin masalar)
PR#3 (admin shell+areas) ┘
PR#2 (menu view)        — paralel, bağımsız
PR#5 (admin kategoriler) ─→ PR#6 (admin ürünler)
                              (PR#3 shell sonrası)
```

**Önerilen yürütme:** PR#1 → (PR#2 ‖ PR#3) → (PR#4 ‖ PR#5) → PR#6.

## İlk PR hedefi (PR #1)

`tablesRepo.baseQuery` select listesine `tables.area_id` ekle, `TableWithStatus` interface güncelle, `ApiTable` web tipine `area_id: string | null` ekle, Sprint 8b'de bekleyen tab badges'i (`İç Salon (0/25)` vb.) gerçek `area_id` filtresine bağla. Audit yok, sadece projection genişlemesi. Contract + integration testleri güncellenir.

## Açık sorular (yok — tüm noktalar önceki ADR'larla kapalı)
