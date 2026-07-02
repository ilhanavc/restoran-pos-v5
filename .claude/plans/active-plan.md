# Aktif Plan — Phase 4: Mobil Garson Uygulaması (İŞ DEVAM EDİYOR)

> Bu dosya o an üzerinde çalıştığımız sprint'in tek kaynağıdır. Phase/sprint değişince **tamamen yenilenir**.
> Tüm faz roadmap'i: `docs/project-charter.md` → "Faz Roadmap". Geçmiş detay: git history + memory `project_session_*_summary.md`.

**Son güncelleme:** 2026-07-02 (Session 78 kapanışı)
**main HEAD:** `4660e3a` (PR #244 sonrası) · **0 açık PR** · Session 78 = 5 PR merged (#240-244)

## Durum: Phase 0-3 ✅ · Phase 4 mobil backend+iskelet ✅ · ekranlar ✅ (5a-5d + **ADR-027 Faz A operasyonel terminal TAM KAPANDI**) · **ADR-028 Faz B "Masayı Değiştir" TAM KAPANDI (mobil+web+backend)** · **menü admin-CRUD realtime (ADR-010 §11.6 Amendment 3)**; realtime v5.1-borçları temizlendi

| Faz | Durum |
|---|---|
| Phase 0-2 | ✅ |
| Phase 3 Sipariş+Mutfak+Ödeme+Yazıcı+Rapor | ✅ (Session 70, tag `v0.3.0`) |
| **Phase 4** Mobil + Caller ID + Audit + Yedek | 🔄 **mobil operasyonel terminal ✅** (Faz B masa-yönetimi kaldı, v5.1) |
| Phase 5 Pilot + Migration | ⛔ Başlamadı |

## Session 78 özeti — 5 PR merged (#240-244) · ADR-028 tamamlayıcı + i18n + 3 chip + ADR-029 tasarım

Her kod PR **Ultracode adversarial verify** + CI yeşil; #240 canlı tarayıcı (Claude-preview) + cihaz realtime doğrulandı.

- **#240 (`da80360`) OrderScreen "Masayı Taşı" wire-up (task_6126413b):** web sipariş ekranı AdisyonPanel "Taşı" no-op placeholder → mevcut `MoveTableModal`'a bağlandı (ADR-028 web parite tamamlama; masa panosu #235 ikizi). `moveOpen` state + dine_in&persisted guard + `onMoved`→invalidate(['tables'])+navigate('/tables'); `AdisyonPanel.onTransferTable` opsiyonel + presence-gate → takeaway-edit'te buton gizlendi (latent dead-button). **+ pre-existing kontrat fix:** `useMoveOrderTable` PATCH yanıtını `{order,items}` sanıyordu ama backend düz DTO döner → `onSuccess`'te `data.order.id` TypeError → **taşıma başarılıyken UI "Masa değiştirilemedi" basıyordu** (#233/#235 pre-existing, masa panosu da etkilenmiş); `mutationFn: Promise<void>` + invalidate-only (mobil ikizle simetrik). 5-lens + 3-lens adversarial verify 0 blocker.
- **#241 (`7579eca`) ORDER_NOT_FOUND message_key (task_7f45a99d):** `AUTH_MESSAGE_KEYS`'te eksikti → 19 `domainError('ORDER_NOT_FOUND',404)` `message_key:'error.internal'` basıyordu. `ORDER_NOT_FOUND:'error.order.notFound'` + errors.test regresyon + web global `error.ORDER_NOT_FOUND` TR; mobil bilinçli değişmez. api **609 PASS** + canlı API zarfı kanıtı; 4-lens verify 0 blocker.
- **docs PR (`chore/session-78-docs`):** `task_0484571c` decisions.md ADR-017 conflict marker temizliği (reports Amendment v2 tablosu ADR-015 §3.1'e taşındı, bilgi kaybı yok) + CHANGELOG Session 53 navigasyon stub'ı (53-69 gerçek boşluk yok) + context-anchor §2 + active-plan (bu güncelleme).
- **#243 (`a94af89`) AUTH_MESSAGE_KEYS registry-completeness (task_56cd16fe):** kalan 9 domainError kodu registry'ye (generic `error.internal` sınıfı kapandı; generic'ler toHttpError kanonik anahtarıyla hizalı) + kaynak-tarama completeness lint testi (kayıtsız yeni kod → test kırılır) + TakeawayOrderCard ölü `data.error.message` dalı → code-bazlı lookup. api errors.test 11/11; 4-lens verify 0 blocker.
- **#244 (`4660e3a`) masa-taşıma UX polish (task_4d212295 + task_47cd76cb):** AdisyonPanel "Taşı" dokunma hedefi 28→40px (canlı tarayıcıda ölçüldü) + `MoveTableModal.onMoved` başarı/yarış ayrımı (`'moved'`→kapan/git, `'occupied'`→picker'da kal; TablesListPage+OrderScreenPage parite) → yarışta toast "başka masa seç" ile uyumlu. Başarı akışı canlı tarayıcıda doğrulandı.
- **Kapanan chip'ler:** task_6126413b · task_7f45a99d · task_0484571c · **task_56cd16fe · task_4d212295 · task_47cd76cb** → aktif küçük-iş backlog'u TEMİZ.
- **ADR-029 "Adisyon Birleştir" TASARIM HAZIR** (`.claude/plans/adr-029-birlestir-brief.md`): 2 DOLU masayı ürün+tutar bazında birleştir (`POST /orders/:sourceOrderId/merge {targetTableId}`; kaynak `order_items`→hedef re-parent, kaynak `merged` terminal, kaynak masa boşalır). Kararlar KİLİTLİ (kullanıcı onaylı): kalem **APPEND** (ayrı satır) · **ödemesizse** birleştir (payment varsa 409 `ORDER_HAS_PAYMENTS`) · yeni **`merged` enum** + migration + `orders_tenant_table_open_uq` partial-index güncelleme · `orders.merge` yetkisi (kitchen hariç) · 2× `tables.changed` · audit `order.merged`. **Implementasyon TAZE OTURUMA bırakıldı** (büyük: migration+backend+mobil+web+test = 3 PR; oturum-sonu altyapı yorgunluğu). Açık: v3 referansı teyidi.

## Session 77 özeti — 5 PR merged (#233-236, #238) · ADR-028 Masayı Değiştir + menü realtime

Her PR **Ultracode Workflow adversarial verify** + CI yeşil; UI'lar **cihaz/tarayıcı + iki-yön realtime** doğrulandı.

- **#233 (`c26753d`) ADR-028 PR-1 backend — `PATCH /orders/:orderId/table {tableId}`:** aktif `dine_in` siparişi aynı tenant'ta BAŞKA bir BOŞ masaya taşır (customer-assign presedent ikizi). Yeni `orders.move` yetkisi (admin/cashier/waiter, kitchen HARİÇ; **rol-only, ownership ABAC YOK** — ADR-008 §7e). Repo `moveToTable` tek-tx `SELECT FOR UPDATE` → dine_in/terminal/same-table guard → hedef tenant+`deleted_at` guard → occupancy ön-kontrol + partial unique index `orders_tenant_table_open_uq` **atomik backstop** (23505→409, 23503→404); snapshot re-türetim `tableLabel()`+`areas.name` (create ile birebir); audit `order.table_changed`; **migration YOK**; realtime 2× `tables.changed{action:'updated'}` (kaynak+hedef, şema değişmez). `orders-move-table` 15 test, **api 601 PASS**.
- **#234 (`ea80990`) ADR-028 PR-2 mobil:** garson dolu-masa 3-nokta sheet'e "Masayı Değiştir" (`MoveTableSheet` picker→confirm; boş-masa bölgeye gruplu, kaynak hariç). Verify fix: `onError` stage sıfırlamayı bırakma (hata mesajı görünür kalsın) + confirmMessage çift-"masa" düzeltme.
- **#235 (`e5a2457`) ADR-028 PR-3 web:** kasiyer masa panosu dolu-kart 3-nokta menüsündeki placeholder→gerçek akış (`MoveTableModal`). hci blocker fix: `TableCard` tetikleyici dokunma hedefi **28→44px**; picker `focus-visible` ring + hata metni aksiyon-önerili.
- **#236 (`4623054`) fix(web) — pre-existing keşif (ADR-028 dışı):** bölge **masa-sayısı düşürme** dolu masa varken `AREA_SYNC_OCCUPIED` (409, guard DOĞRU) generic "Masa sayısı güncellenemedi" basıyordu → `error.AREA_SYNC_OCCUPIED` i18n eklendi (Session 77 masa-değiştir doğrulaması sırasında bulundu).
- **#238 (`9e4820f`) feat(realtime) — menü admin-CRUD canlı senkron (ADR-010 §11.6 Amendment 3):** kullanıcı gözlemi (web admin ürün/kategori CRUD mobilde anlık yansımıyordu — mobil 5dk staleTime, web'de consumer yok). tables/areas #231 aynası: `products.changed`/`categories.changed` invalidate-only tenant-room event; `products.ts`/`menu.ts` emit + `app.ts` io-threading + web `OrderScreenPage` + mobil `RealtimeBridge` consumer (staleTime bypass); 7 emit testi (M1-M7), **api 608 PASS**; cihazda menü anlık senkron doğrulandı. security+scope-lock verify clean.

**Açık takip chip'leri:** `task_7f45a99d` (ORDER_NOT_FOUND `AUTH_MESSAGE_KEYS`'te yok → ~9 order endpoint 404'te generic message_key + TR çeviri riski) · `task_6126413b` (web OrderScreen "Masayı Taşı" no-op placeholder → `MoveTableModal`'a bağla) · `task_0484571c` (decisions.md ADR-017 git conflict marker).

## Session 76 özeti — 5 PR merged (#227-231)

Her PR **Ultracode Workflow 6-way adversarial verify** + CI yeşil + (UI'lar) cihaz/realtime doğrulama.

- **#227 (`4f80709`) ADR-027 Faz A PR-4 — mobil operasyonel terminal:** dolu-masa 3-nokta sheet (Masalar kebab + Order başlık) → **Hızlı Öde** (Nakit/Kart → **K3 hafif onay** → `POST /payments` full+`pay_and_close`; tutar=split-state `remaining_total_cents`; idempotency retry-stabil; pending-iken-kapatma kilidi) + **Adisyon Yazdır** (`POST /orders/:id/print-bill`). K6 gating tek kaynak `apps/mobile/src/features/orders/actions.ts`; `TableActionsController` tek-modal state machine. **Ürün sahibi kararı: "Öde" tam ödeme ekranı KAPSAM DIŞI → v5.1.** Split/Faz B/iptal/comp/müşteri-ata render EDİLMEZ. Cihaz+web realtime testli.
- **#228 (`e84e88f`) web i18n/a11y temizliği:** `tables.actions` duplicate key birleştirildi (a11y bug: `openMenu` aria-label ham key basıyordu) + 3 hardcoded metin (Çağrılar/Faz-4-tooltip/Yenile) i18n key'e.
- **#229 (`90df43f`) realtime emit testleri (P1-P5):** `apps/api/src/__tests__/realtime-emits.test.ts` — dine-in create / add-items+KDS / cancel / waiter pay-close / takeaway emit+payload+room assert.
- **#230 (`ebeba19`) takeaway paneli poll→socket:** `useOpenTakeawayOrders` 5sn poll kaldırıldı → `orders.*` invalidation (ADR-017 §6 stopgap çözüldü).
- **#231 (`55f43b0`) masa/bölge admin-CRUD realtime — ADR-010 §11.6 Amendment:** 2 invalidate-only event `tables.changed`/`areas.changed` (tables/areas router emit + `io?` threading; web+mobil board `['tables']`+`['areas']` invalidate); 8 emit testi.

**api suite pos_test 586 PASS.**

## Phase 4 — Mobil Garson Uygulaması (ADR-025 + ADR-026 + ADR-027)

### İş kalemleri
1. **ADR-025 Mobil Kickoff** — ✅ #204
2. **Auth body-refresh** — ✅ #205
3. **Garson ABAC genişletme (K4)** — ✅ #206
4. **Tipli `orders.*` realtime** — ✅ #207
5. **Mobil iskelet (Expo SDK 54)** — ✅ #208
6. **EKRANLAR (İş Kalemi 5)** — ✅ (ADR-026): PR-5a Login #211 · PR-5b Masalar #212 · PR-5c Order+Adisyon+Ayarlar #214 · PR-5d gerçek API + realtime tamamlama #221.
7. **MOBİL OPERASYONEL TERMİNAL (İş Kalemi 6) — ADR-027:**
   - **Faz A backend** ✅ (PR-2 #217 `payments.create`+waiter · PR-3 #218 `POST /orders/:id/print-bill`).
   - **Faz A PR-4 mobil UI** ✅ **#227** (Hızlı Öde + Yazdır + K3; "Öde" tam ekran → v5.1).
   - **Faz A TAM KAPANDI.**
   - **Faz B — Masayı Değiştir (ADR-028) ✅ KAPANDI** (Session 77, #233-235 backend+mobil+web). Kalan: **Birleştir (ADR-029)** + **Adisyon Aktar (ADR-030)** rezerv, muhtemelen **v5.1**. Her biri kendi ADR + migration(gerekirse) + endpoint + ABAC + UI + test (masada-tek-aktif-sipariş invariant'ına dokunur — ADR-027 K6).

## Sıradaki iş (aday backlog — hepsi düşük öncelik / v5.1)

- **▶ SIRADAKİ (v5.1, BÜYÜK): ADR-029 "Adisyon Birleştir"** — tasarım HAZIR + kararlar KİLİTLİ (`.claude/plans/adr-029-birlestir-brief.md`, Session 78). 2 DOLU masayı ürün+tutar bazında birleştir. Taze oturumda: architect ADR'yi decisions.md'ye resmileştirir → PR-1 backend+migration (yeni `merged` enum + partial-index + `mergeInto` repo + `POST /orders/:sourceOrderId/merge` + 6 hata kodu + test) → PR-2 mobil `MergeTableSheet` → PR-3 web `MergeTableModal`. Açık: v3 referansı teyidi. (ADR-030 Adisyon Aktar rezerv — kullanıcı "aktar" = birleştir dedi, ADR-029 bunu kapsıyor; ADR-030 gerekirse kısmi-aktar için.)
- ~~`task_7f45a99d` · `task_6126413b` · `task_0484571c` · CHANGELOG backfill~~ ✅ **Session 78 (#240/#241/docs)**.
- ~~`task_56cd16fe` · `task_4d212295` · `task_47cd76cb`~~ ✅ **Session 78 (#243/#244)** — 3 v5.1 chip'i kapandı.
- Deploy-zamanı manuel smoke (DB yedek restore drill + USB yazıcı pilot — donanım/sunucu).
- Worktree disposal (Windows file-lock, kozmetik).

## Ortam & dev-loop (Session 74/76 reçetesi)

- **Windows native PostgreSQL 17.10** `D:\PostgreSql` (servissiz → `Start-Process pg_ctl` detach + WAL-recovery poll [[feedback_native_postgres_detached_start]]). İki DB: **`pos_dev`** (dev/device, seed+waiter) / **`pos_test`** (test — `DELETE FROM tenants`, ayrı [[feedback_local_test_db_separate]]).
- Dev-loop: API `pnpm --filter @restoran-pos/api dev` (:3001) · web `pnpm --filter @restoran-pos/web dev` (:5173) · Metro `EXPO_NO_DEPENDENCY_VALIDATION=1 EXPO_OFFLINE=1 REACT_NATIVE_PACKAGER_HOSTNAME=192.168.1.88 expo start --lan` → `exp://192.168.1.88:8081` (Expo Go, [[feedback_mobile_expo_go_devloop]]).
- Login: admin@local.test/admin1234 · garson@local.test/garson1234.
- Lokal test koşumu: `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pos_test" pnpm --filter @restoran-pos/api test` (**586 PASS**). **CI hâlâ tek otorite** — kod PR'ında merge öncesi CI yeşilini POLL et (auto-merge gerekli-check yoksa anında merge eder [[feedback_merge_wait_ci_no_required_checks]]).

## Çalışma kuralları (değişmez — CLAUDE.md)

- ADR önce, kod sonra. DoD olmadan "bitti" yok. Branch-first. Cerrahi değişiklik.
- UI → hci+turkish-ux+i18n. Auth/payment/PII → security-reviewer. DB şema → db-migration-guard.
- Kapsam kilidi: v5.0 MVP'de yoksa v5.1 backlog veya ADR.
- Ultracode açıksa: substantive iş → Workflow ile implement → 6-yönlü adversarial verify.
