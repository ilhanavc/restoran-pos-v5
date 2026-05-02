# v3 Frontend Davranış Spesifikasyonu — Sipariş Alma Akışı (Derin Keşif)

**Kapsam:** v3 (`D:\dev\restoran-pos-v3\client\src`) sipariş alma + adisyon + ödeme + masa transfer + müşteri atama + print + realtime davranışları.

**Amaç:** v5 mini-sprint PR-3..PR-12 için referans. Kod kopyalama YASAK; bu doküman davranış kurallarını dosya:satır referansıyla özetler. Kullanıcı kendi cümleleriyle yazılmış kuralları v5 yeniden implementasyonunda kullanır.

**Statü:** Session 49+ Explore sub-agent çıktısı (2026-05-02). Önceki yüzeysel keşfin (ilk Explore raporu) doğrulanmış + genişletilmiş hali.

---

## 1. OrderScreen + Alt Component'ler

**Behavior:** OrderScreen flat `useState` ile yönetilir (useReducer yok). Durum: `cartItems` (pending), `existingOrder` (persisted), `saving`, `modifierModal`, `lineDetailModal`, `moveModalOpen`, `emptyTables`, `takeawayPhone`, `selectedCustomer`, `pendingCustomerChange`, `paymentTypeModalOpen`, `confirmDialog`.

**File:line:** `OrderScreen.jsx:74-130` (tüm state tanımları).

**State machine özeti:**
- `existingOrder === null && cartItems.length === 0` → boş, Kaydet disabled
- `cartItems.length > 0 && !existingOrder` → yeni sipariş; Kaydet görünür (takeaway ise müşteri zorunlu + ödeme tipi modal)
- `existingOrder && cartItems.length > 0` → mevcut + pending; Kaydet görünür, Ödeme yok
- `existingOrder && cartItems.length === 0` → sadece persisted; Ödeme + Hızlı Öde görünür

**v5 implications:** flat useState v5'te de uygun ama TypeScript interface ile state shape kilitle.

---

## 2. Ürün Ekleme + Qty Stepper

**Quick-add akışı (kart tıklama):**
1. `quickAddFromGrid(product)` — `OrderScreen.jsx:172-228`
2. `api.getProduct(id)` + `api.getModifiers(id)` (sequential, paralel değil)
3. `portions.length > 0` → `is_default=1` olan, yoksa `portions[0]`
4. `modGroups` (legacy) varsa → `ModifierModal` açılır
5. Yoksa direkt `addItemToCart()` → qty=1, default portion

**Stepper overlay:** `getCartQtyForProduct(product) > 0` ise kart sağ kenarında dikey kırmızı (`var(--danger)`) panel (width:46px). `+` → `quickAddFromGrid`, `-` → `decrementProductInCart`. stopPropagation ile event izole. Focus yönetimi yok. Kaynak: `OrderScreen.jsx:~840-870`.

**Composite row key (deduplication):** `useCart.js:13-30` — `product_id + portion_id + JSON(modifiers) + JSON(selected_attributes) + note` 5-tuple eşleşmesi gerekir; biri farklıysa yeni satır, hepsi aynıysa qty++.

**Modal sonrası cart'a yazılan snapshot:** `product_id, product_name, unit_price = product.price + modDelta + attrExtraPrice, base_price, quantity, modifiers[], selected_attributes[], note, category_name, portion_id, portion_label`. Kaynak: `useCart.js:37-55`.

**AttributePickerModal vs OrderProductDetailModal:** v3'te ürün kartına tıklamada sadece `quickAddFromGrid`. `AttributePickerModal` OrderScreen'de kullanılmıyor (standalone flow). `OrderProductDetailModal` mevcut satıra tıklama (`lineDetailModal`).

**v5 implications:**
- `api.getModifiers` legacy, v5'te attribute_groups product ile tek endpoint'te
- Composite key: `(product_id, portion_id, modifiers_hash, attributes_hash, note)` — PR-6'da rowId composite olur
- Stepper overlay v5 PR-3'te kart üzerine TAM-BOY (v3 yan dikey panel ≠ v5 tam-boy seçimi — kullanıcı onayı PR-3 ekran 2/3 paritesi)

---

## 3. Persisted Kalem Davranışları

**canEditOrderItem:** `item.status === 'new' && !item.is_comped && order.status !== 'closed'` — `orderActionPolicy.js:22`

**canVoidOrderItem:**
- Çerçeve: `order.status !== 'closed' && !item.is_comped`
- `item.status === 'new'` → herkes void edebilir
- `item.status !== 'new'` → sadece `hasRole('admin','cashier')` void edebilir

Kaynak: `orderActionPolicy.js:26-31`, `OrderScreen.jsx:1074-1098`.

**Soft cancel akışı:** `api.updateOrderItem(orderId, itemId, { status: 'cancelled' })` → `refreshOrder()` → `setExistingOrder(updated)`. Qty 0'a düşünce de aynı path. Kaynak: `OrderScreen.jsx:318-348, 349-395`.

**İkram (comp):** `item.is_comped=true` → `opacity:0.5`, `readOnlyQuantity=true`, `readOnlyPortion=true`, `subtitle='İkram satırı — düzenlenemez'`. **OrderScreen'de comp toggle UI YOK** — comp sadece server-side set edilebiliyor. Kaynak: `OrderScreen.jsx:1006, 1372-1395`.

**Item-level note:**
- `isNew=true && !comped` → note editable
- `isNew=false && !comped` → note editable (qty/portion readonly)
- `comped=true` → tüm alanlar readonly

**v5 implications:**
- Comp toggle UI gerekirse v5'te `PATCH /orders/:id/items/:itemId { is_comped }` + admin/cashier rol kontrolü ekle
- `canVoidOrderItem` davranışını ADR-013 §6 Karar 6'ya verbatim uygula

---

## 4. Adisyon Panel Layout Detayları

| Özellik | v3 değeri | Kaynak |
|---|---|---|
| Panel width | 460px sabit | `OrderScreen.jsx:~870` |
| Panel bg | `var(--bg-secondary)` | a.g.y. |
| Empty state | `<ClipboardEmpty />` + "Ürün ekleyin", padding 32 | `OrderScreen.jsx:~1145` |
| "Mevcut Ürünler" başlık | 11px, fw 600, muted, uppercase, letter-spacing 0.05em, padding 6/18 | `~985` |
| "Yeni Ürünler" başlık | Tam string YOK; `var(--accent)` uppercase + "Kaydedilmedi" badge `var(--accent-muted)` | `~1110-1120` |
| Pending satır | `borderLeft 3px solid var(--accent)`, padding 10/18; stepper minHeight 40, padding 6, minWidth 40 | `~1125-1155` |
| Persisted satır | `borderBottom 1px solid var(--border)`, padding 12/18; `opacity: is_comped ? 0.5 : 1` | `~1022-1045` |
| Actor + timestamp | `item.created_by_name + formatTimeInIstanbul(item.created_at)` — DOĞRULANDI v3'te `created_by_name` alanı VAR (önceki "user_name yok" notu yanlıştı, `created_by_name` adıyla mevcut) | `~1022-1045` |
| Sıralama | Persisted üstte ("Mevcut Ürünler") + Pending altta ("Yeni Ürünler"); persisted DB sırası filter `status !== 'cancelled'` | `~990` |
| Header pending rozeti | "X kayıtlı ürün" sub-text VAR; pending count badge YOK | header |
| Virtual list | YOK, düz `.map()` | a.g.y. |

**v5 implications:**
- Backend `order_items.created_by_name + created_at` v5'te de döndürülmeli (ADR-013 §5 actor rozeti gereksinimi)
- Header pending count badge eklenebilir (v3'te yok ama v5 değer ekleyebilir)
- Virtual list 30+ kalem için PR-12 sonrası nice-to-have

---

## 5. Bottom Action Bar State Machine

| State | Görünüm |
|---|---|
| **Empty** (cart=0, no existing) | Sadece toplam, buton yok |
| **Pending only** (cart>0, no existing) | Hint "Yeni ürünleri kaydettikten sonra ödeme aksiyonları açılır." + Kaydet (btn-primary, w-full, minHeight 46) |
| **Pending + persisted** | Aynı: sadece Kaydet (mor); Ödeme YOK |
| **Persisted only** (cart=0, existingOrder, status valid, items>0) | 2-col grid: Ödeme (btn-primary) + Hızlı Öde (btn-success); `disabled={saving \|\| !onQuickPayment}` |
| **pendingCustomerChange** | "Müşteri değiştirilecek" + Kaydet override |
| **Closed/cancelled** | Ödeme butonları yok; Print toolbar'da var |

Kaynak: `OrderScreen.jsx:1227-1290`.

**v5 implications:** State machine birebir kopyalanabilir. Kaydet + Hızlı Öde **asla eş zamanlı görünmez** — invariant.

---

## 6. Hızlı Öde + Ödeme

**QuickPaymentModal 4 operasyon:** `pay`, `pay-close`, `pay-print`, `pay-print-close`. Default `pay`. `QuickPaymentModal.jsx:1-15`.

**API:** `api.createPayment({ order_id, payment_type, amount, cash_received, close_order, print_receipt, print_printer_id })`. **Idempotency key YOK** — v3'te uygulanmamış. Modal kapanıp açılınca `processingType` reset → yeni istek gönderilebilir, çift submit riski mevcut. Kaynak: `QuickPaymentModal.jsx:~55-80`.

**SplitPaymentModal:** Tek mod — "Kalan ürünler" sol panel + "Kişiler" sağ panel; **Equal/Amount/ByPerson modları YOK**, sadece **item-bazlı manuel atama**. Her payer için `paymentType` (cash/card) + `cashReceived` + `tipAmount`. Hata durumunda `await loadState()` refresh. Kaynak: `SplitPaymentModal.jsx`.

**Partial payment:** `getTotalDue` pozitif → sipariş açık kalır, `getPaymentStateLabel === 'partial'` (color: `var(--warning)`).

**İkram kalemler ödeme ekranında:** Server `state.items` döner; comped kalemlerin `remaining_quantity=0` ise listede yer almaz.

**v5 implications:**
- **Idempotency key v5'te ZORUNLU** (ADR-014 §4 — kullanıcı onayı). UUID v4 üret, modal açılışında bir kere, header `Idempotency-Key`.
- SplitPaymentModal'a v5'te Equal/Amount eklemesi yapılabilir (kullanıcı tercihi PR-7'de) — v3'te yok ama domain talebi var.

---

## 7. Müşteri Atama

**CustomerDetailsModal:** `view: 'list' | 'edit'`. List view debounced search. Edit view: `first_name, last_name, phone, phone_2, note`. `api.getCustomer(id)` ile form. Kaynak: `CustomerDetailsModal.jsx:1-100`.

**Patch:** `PATCH /orders/:id/customer { customer_id }` via `api.patchOrderCustomer`.

**Takeaway müşteri zorunluluğu:** `canSaveOrderDraft` içinde `orderType === 'takeaway' && !selectedCustomer?.id` → `{ ok:false, reason:'customer-required' }`. Kaynak: `orderActionPolicy.js:33-38`.

**CallerIdScreen:** `IncomingCallContext`, `openOrder(call)` ile order ekranına geçer; `call_log_id` createOrder'a geçirilir. Kaynak: `CallerIdScreen.jsx`, `OrderScreen.jsx:289`.

**v5 implications:** Takeaway zorunluluk lojiği PR-12 / PR-8'de aynen geçerli.

---

## 8. Masa Transfer

**TablesScreen `transferMode`:** Source=tableId, target tıklanınca `performTableTransfer(source, target)`. Hedef hep `emptyTables` listesinden (status='empty'). Çakışma UI: "Boş masa yok. Önce başka bir masayı boşaltın." Kaynak: `TablesScreen.jsx:48, 248, 260-282`.

**OrderScreen'den transfer:** Sadece `dine_in` + `table?.id` varsa "Masa taşı" butonu. `api.transferTable(sourceId, targetId)`. Kaynak: `OrderScreen.jsx:408-440`.

**Socket sync:** TablesScreen 30s fallback polling + `'table:updated', 'table:transferred', 'order:created', 'order:updated', 'order:takeaway_delivery'` events. Kaynak: `TablesScreen.jsx:129-140`.

**Multi-table merge YOK.**

**v5 implications:** Aynı kısıt (source=occupied, target=empty) PR-9'da yeterli.

---

## 9. Print

**ManualPrintSelectorModal:** `printRole = 'receipt' | 'kitchen'`. `api.getPrinterSettings()` + `api.getDiscoveredPrinters()`. Son kullanılan `localStorage['manualPrint:last:receipt']`. Kaynak: `ManualPrintSelectorModal.jsx:1-120`.

**Receipt print akışı:** Toolbar Printer ikonu → modal → `api.printOrderReceipt(orderId, { printer_id })`.

**Otomatik kitchen print:** `QuickPaymentModal.createPayment({ print_receipt:true, print_printer_id })` flag → server-side. Client-side `printerAutoPrintPolicy` dosyası YOK (server-side). `printRouting.js` da client'ta YOK.

**v5 implications:** Otomatik routing server-side; client sadece flag geçirir. ADR-014 §7-8 bu yapıyla uyumlu.

---

## 10. Realtime Senkronizasyon

**SocketContext:** `socket.io-client`, `reconnection:true, reconnectionAttempts:Infinity, reconnectionDelayMax:30000`. `subscribe(event, cb)` API. `isConnected` HomeScreen'de `conn-dot-on/off` indicator.

**OrderScreen socket subscribe YOK.** Değişiklikler `refreshOrder()` ile manuel pull. **Concurrent edit koruması YOK** — son yazan kazanır.

**HomeScreen:** `'order:created, order:updated, payment:created'` → loadLive/loadHeavy. Kaynak: `HomeScreen.jsx:136-147`.

**TablesScreen:** Yukarıda; 30s polling fallback.

**Connection loss:** `conn-dot-off` badge; banner yok.

**v5 implications:**
- ADR-013 §3 (Concurrency = B socket warning) v3'te yok — v5 yeniliği. OrderScreen'de `order:edit_session_started` subscribe + banner ekle.
- Optimistic update + rollback için tanstack-query mutation kullan (PR-4).

---

## 11. Klavye Kısayolları + Erişilebilirlik

- **OrderProductDetailModal:** Esc → onCancel (`document.addEventListener('keydown')`).
- **AttributePickerModal:** benzer Esc handler.
- **OrderScreen global kısayol YOK.**
- **Persisted satırlar:** `tabIndex={0}` + `onKeyDown` Enter/Space modal açıyor.
- **Touch:** Stepper minWidth/minHeight 40 (44px hedefine yakın değil tam). Toolbar minHeight 46.

**v5 implications:**
- Ctrl+S → handleSaveOrder shortcut (PR-4 ekleyebilir).
- 44px minimum touch target zorunlu (HCI checklist) — stepper'lar 44'e çıkmalı.

---

## 12. Edge Case'ler

| Senaryo | v3 davranışı |
|---|---|
| Fiyat değişikliği | `quickAddFromGrid` her seferinde `getProduct(id)` çeker; mevcut cart kalemleri güncellenmez |
| Soft-deleted ürün | Catalog cache'inde görünebilir; `getProduct` 404 → toast.error |
| Network kesintisi (Kaydet) | `setSaving(false)` finally'de; `toast.error(err.message)`; cart temizlenmez (retry mümkün); optimistic YOK |
| Concurrent edit | Korunma YOK |
| Büyük adisyon (50+) | Düz `.map()`, virtual list yok; Electron'da pratik limit yüksek |

**v5 implications:** Optimistic update için tanstack-query `useMutation` + `onMutate/onError/onSettled`. Concurrent guard için server `updated_at` version (ADR-013 §3 alternatifi).

---

## Önceki "Doğrulanmamış" Notların Doğrulanması

| Konu | İlk keşif notu | Derin keşif sonucu |
|------|----------------|---------------------|
| Actor adı item bazında | "v3'te item.user_name görülmedi" | **DOĞRULANDI: alan adı `created_by_name`** (`OrderScreen.jsx:~1022-1045`); v5 backend de bu kolonu döndürmeli |
| Idempotency key | belirsiz | **YOK — v3'te uygulanmamış**, v5'te ADR-014 §4 zorunlu |
| Comp toggle UI | belirsiz | **YOK — server-side only**; v5'te UI eklemek istisna |
| SplitPayment modları | "equal/amount/items" varsayım | **YOK — sadece item-bazlı manuel atama**; v5 ek modlar geliştirme kararı |
| printRouting client | belirsiz | **YOK — server-side**; v5 aynı pattern |
| OrderScreen socket | belirsiz | **YOK — manuel refresh**; v5'te `order:edit_session_started` ekle |
| Virtual list | belirsiz | **YOK** |
| Composite row key | "varsayım" | **DOĞRULANDI: 5-tuple** (product_id + portion_id + modifiers + attributes + note) |

---

## v5 Mini-Sprint İçin Aksiyon Listesi

| PR | Bu doküman tarafından netlenen |
|----|-------------------------------|
| **PR-3** (mevcut) | Pending qty stepper davranışı doğrulandı; v5 tam-boy overlay seçimi v3'ün yan-dikey panelinden farklı (kullanıcı onayı) |
| **PR-4** (Kaydet) | Optimistic update yok v3'te; tanstack-query mutation + manuel retry |
| **PR-5** (Persisted) | `created_by_name` alanı backend gereksinimi; `canVoidOrderItem` rol matrisi (admin/cashier `status!=='new'` void) |
| **PR-6** (Varyant + attribute modal) | Composite 5-tuple row key; `unit_price = base + portion.delta + Σ extra_price + modDelta` snapshot |
| **PR-7** (Hızlı Öde + Split) | 4-operasyon modal default `pay`; SplitPayment item-bazlı tek mod (Equal/Amount v5 ek geliştirme); idempotency key yeni; partial payment → `state='partial'` |
| **PR-8** (Müşteri) | Takeaway customer-required; Caller ID `call_log_id` order'a geçir |
| **PR-9** (Transfer) | source=occupied, target=empty kısıtı; multi-merge yok |
| **PR-10** (Print) | Manual receipt: localStorage last printer; auto-kitchen server-side flag |
| **PR-11** (Tables dolu state) | Socket events list; 30s polling fallback |
| **PR-12** (Paket) | Takeaway customer zorunluluğu pre-save lojiği |

---

**Cross-ref:**
- ADR-013 (Sipariş Alma UI Mimarisi, 8 karar)
- ADR-014 (Ödeme Akışı, 8 karar)
- v3 dosyalar: `D:\dev\restoran-pos-v3\client\src\components\orders\*`, `client/src/utils/orderActionPolicy.js`, `client/src/components/payments/*`, `client/src/components/tables/TablesScreen.jsx`
- Önceki sub-agent raporu (Session 49 ilk keşif, yüzeysel) — bu doküman onun derinleştirilmiş hali.
