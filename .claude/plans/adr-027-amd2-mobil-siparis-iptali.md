## ADR-027 Amendment 2 — Mobil Sipariş İptali (garsona açılır) + İptal Fişi Kasa Kopyası

- **Durum**: **Accepted (2026-07-20)** — ürün sahibi kararı: "3-nokta menüsüne *Siparişi iptal et* eklensin, **garson da iptal edebilsin**." Açık kalan dört madde aynı gün karara bağlandı:
  1. **Paket iptali** → garson **paket/gel-al siparişlerini de** iptal edebilir → **K6 DÜŞTÜ** (sipariş türü kısıtı yok).
  2. **İptal fişi kasa kopyası** → *"kasadan iptal fişi çıkmasına gerek yok, yalnızca ilgili mutfak yazıcısından çıkmalı — fırın veya ızgara"* → **K10 ve K11 DÜŞTÜ**; istenen davranış ADR-032 Amd1 K14 ile zaten canlı, bu Amendment'ta fiş tarafında iş yok.
  3. **Kısmi ödenmiş adisyon** → **hiç kimse iptal edemez (admin dahil)** → **K3 onaylandı**; bu aynı zamanda `cancelOrderTx`'teki mevcut sessiz açığı da kapatır.
  4. **İptal sebebi** → 5 ön-tanımlı seçenek yeterli, serbest metin yok → **K7 onaylandı**.

  Kalan kapsam: yetki matrisi (K2) · para kapısı (K3) · `merged` guard (K4) · mutfak kalemi serbest (K5) · sebep (K7) · mobil UI (K8) · kanonik uç (K9) · audit (K12) · realtime (K13).
- **Tarih**: 2026-07-20
- **İlişki**: ADR-027 K1/K2 (mobil operasyonel terminal; iptal/comp/müşteri-ata KAPALI) — **bu Amendment K2'nin iptal maddesini geri alır**. Bağlı: ADR-008 §7c (garson iptal yapamaz) · ADR-034 B2 (2026-07-12; `orders.cancel` kasiyerden KALDIRILDI) · ADR-025 K4 / ADR-008 Amendment 2026-06-28 (garson tenant-geneli açık adisyon görür — own-only filtre KALDIRILDI, masa-devri) · ADR-014 §9.6 + Amd1 (iptal domain + otomatik iptal) · ADR-024 Amd1 K1/K2 (`order.cancelled` audit, kanonik payload `{order_id, auto}`) · ADR-004 Amd6 (iptal fişi) · ADR-004 Amd9 (raster render) · ADR-032 Amd1 K14 (iptal fişi istasyon yönlendirmesi) · ADR-029 (`merged` terminal statü) · ADR-033 (`payments.voided_at`) · ADR-002 §6 (RBAC matris) · ADR-026 K6 (yetkisiz aksiyon hiç render edilmez).
- **Kapsam (dosya)**: `packages/shared-types/src/permissions.ts` · `apps/api/src/routes/orders.ts` · `packages/db/src/repositories/orders.ts` (`cancelOrderTx` guard) · `apps/api/src/print/enqueue-cancel-job.ts` · `apps/api/src/print/templates/cancel-receipt.ts` · `packages/shared-domain/src/audit/allowed-keys.ts` · `apps/api/src/__tests__/rbac-parity.test.ts` · `apps/mobile/src/features/orders/actions.ts` + `components/TableActionSheet.tsx` + `features/payments/TableActionsController.tsx` + i18n `tr`.

### Neden Amendment (yeni ADR değil)

ADR-027'nin **kendi K2 kararını** revize ediyor (aynı ADR'nin yetki sınırı) ve aynı 3-nokta menüsünün aksiyon kümesini genişletiyor. Yeni domain/aggregate doğmuyor, migration yok. Ancak **iki kırmızı bayrak** var (auth/authorization değişikliği + parasal etki) → security-reviewer zorunlu.

### Bağlam

**Bugünkü kod gerçeği (hepsi doğrulandı, 2026-07-20):**

1. **Matris**: `permissions.ts:100` — `orders.cancel` kasiyerde YOK (ADR-034 B2, "route kaynak-doğru → matris hizalandı"); garsonda da YOK. Yalnız admin.
2. **İki farklı iptal yolu, iki farklı yetki:**
   - `POST /orders/:id/cancel` → `authorize(['admin'])`, gövdesi `repo.cancelTakeawayOrder` → **yalnız takeaway** (`status='open' AND takeaway_stage='preparing'`).
   - `PATCH /orders/:id {status:'cancelled'}` → `authorize(['admin','cashier'])`, gövdesi `repo.cancelOrderTx` → **dine-in iptali burada**. Yani **kasiyer bugün dine-in adisyonu İPTAL EDEBİLİYOR**; matris "cancel yok" diyor. Parite testi bu route'u `action: null` ("operasyonel-kısıtlı") diye işaretleyerek çelişkiyi *tolere* ediyor (`rbac-parity.test.ts:121`).
   - **KRİTİK**: `PATCH /orders/:id` **ikili amaçlı** — `status:'paid'` dalı *Mod B "Masayı Kapat"* (ödeme almadan masayı kapatma). Bu route'a garson eklenirse garson **para toplamadan adisyon kapatabilir**. Route'u olduğu gibi garsona açmak kabul edilemez.
3. **`cancelOrderTx` guard'ı (repositories/orders.ts:1189)** yalnız `paid|cancelled|void` reddediyor. Sonuçlar:
   - **Kısmi ödenmiş adisyon iptal edilebiliyor** (kısmi ödeme siparişi `open` bırakır — payments.ts:181). İptal `orders.total_cents=0` yazar, `payments` satırları **öksüz kalır** → kasada para var, adisyon "iptal". Bu bugün de bir veri-bütünlüğü açığı; garsona açmak yüzeyi büyütür.
   - **`merged` reddedilmiyor** — `TERMINAL_ORDER_STATUSES` = `paid|cancelled|void|merged` (ADR-029), ama guard 'merged'i saymıyor → birleştirilmiş kaynak adisyon "iptal"e çevrilebilir (birleştirme izi bozulur).
4. **İptal fişi** (`enqueue-cancel-job.ts`, bugün ADR-032 Amd1 K14 ile değişti): `resolveItemStations()` ile istasyona göre gruplanıp grup başına `payload.kind = 'kitchen' | 'grill'` yazılıyor. **Kasa kopyası YOK.** Şablon (`cancel-receipt.ts`) **FİYATSIZ** (A3: "işletme başlığı, FİYAT, müşteri PII bilinçli YOK"), raster (Amd9).
5. **Mobil**: `TableActionKind` = `quickPay | printBill | moveTable | mergeTable`; `actions.ts` modül-başı "ASLA (garson kademesinde kapalı): cancelOrder · comp · assignCustomer" + "Rol bazlı gating YOK — bu aksiyonları GARSON DAHİL HERKES yapar".
6. **Mobil profil kalıcı değil**: `store/auth.ts` `hydrate()` yalnız token geri yükler, `user` null kalır ("full user profile is repopulated on the next real login").

### Araştırma bulguları

- **Sahiplik (ownership) ABAC'ı bu projede *bilinçli olarak terk edilmiş*.** `orders.test.ts:390-392`: *"ADR-008 Amendment 2026-06-28 / ADR-025 K4 — garson tenant-geneli AÇIK adisyon görür (masa-devri). Eski own-only `waiter_user_id===self` filtresi kaldırıldı."* ADR-027 ile açılan hiçbir aksiyon (Hızlı Öde, Yazdır, Masa Değiştir, Adisyon Aktar) sahiplik sormuyor — garson **başkasının** masasında ödeme alıyor. `permissions.ts:18/23`'teki "ABAC: only own orders" yorumları **bayat** (kod öyle davranmıyor).
- Var olan tek sahiplik kapısı **kalem seviyesinde**: `canWaiterEditOrderItem(item, currentUserId)` = `status==='new' && created_by_user_id===currentUserId`. Bu **kalem-düzenleme** kapısı; adisyon-düzeyi iptal için emsal değil.
- **Toast/Menulux/SambaPOS deseni**: iptal yetkisi rol matrisiyle değil **"void reason" + denetim raporu** ile yönetilir; garson iptali serbest, gün-sonu "iptal raporu" işletmeciye gider. Kısıt para-durumundadır (ödeme alınmışsa iptal değil, iade akışı).
- v3'te iptal `POST /orders/:id/cancel` — rol kapısı yoktu (tek terminal, tek kullanıcı). v5 çok-kullanıcılı olduğu için denetim izi (kim/neden) v3'ten daha güçlü olmalı.

### Kararlar (K1–K13)

**K1 — Sahiplik-ABAC'ı (yalnız kendi açtığı adisyon) REDDEDİLİR.** Ana context'in önerisi *değerlendirildi ve reddedildi*. Üç gerekçe:
(a) **Operasyona aykırı** — ADR-025 K4 masa-devri kararıyla doğrudan çelişir: garson A masayı açar, vardiya/mola ile garson B devralır; "müşteri gitti" anında B iptal edemez → kasaya koşar; ADR-027'nin çözdüğü semptom geri gelir.
(b) **Tutarsız** — garson zaten *başkasının* masasında ödeme alıyor, adisyon bastırıyor, masayı taşıyor. Parasal olarak daha ağır olan "ödeme alma" sahiplik sormazken, iptalin sorması savunulamaz.
(c) **Teknik olarak kırık** — mobil `auth.user` uygulama yeniden başlayınca `null` (store/auth.ts hydrate); istemci sahipliği hesaplayamaz → aksiyon soğuk-başlatmadan sonra kaybolur/yanlış davranır. Sunucu tarafı `waiter_user_id` ile zorlasa bile UI ile sunucu ayrışır (ADR-026 K6 "yetkisiz aksiyon hiç render edilmez" ihlali).
**Daraltma sahiplikte değil, PARA DURUMUNDA yapılır (K3).**

**K2 — `orders.cancel` matrise geri konur: `waiter` + `cashier`.** `PERMISSIONS.waiter` ve `PERMISSIONS.cashier` setlerine `orders.cancel` eklenir.
- Garson: ürün sahibi kararı (2026-07-20).
- Kasiyer: **kasiyer zaten dine-in iptali yapabiliyor** (PATCH yolu) — matris bayattı. Garson yapıp kasiyerin yapamaması hem operasyonel saçmalık hem matris-yalanı olurdu. **Bu, ADR-034 B2'nin (2026-07-12) kasiyer-kaldırma kararını AÇIKÇA GERİ ALIR**; B2 o gün "route kaynak-doğru" diyerek matrisi route'a hizalamıştı — şimdi ürün kararı route'u değiştiriyor, matris onu izliyor.
- `kitchen` rolü HARİÇ (değişmez).

**K3 — Para kapısı (asıl daraltma): aktif ödemesi olan adisyon İPTAL EDİLEMEZ — tüm roller.** `cancelOrderTx` içinde, `FOR UPDATE` kilidinden sonra, aynı tx'te: `SUM(payments.amount_cents) WHERE order_id=? AND voided_at IS NULL` > 0 ise `409 ORDER_HAS_PAYMENTS` (yeni hata kodu, Türkçe mesaj: "Bu adisyonda tahsil edilmiş ödeme var; önce ödemeyi geri alın."). Kısmi ödeme dahil.
Gerekçe: bugünkü sessiz veri-bütünlüğü açığını kapatır (öksüz `payments` satırı + `total_cents=0`), *ve* "garson iptal edip parayı cebe atar" senaryosunun tek gerçek teknik kapısıdır. Düzeltme yolu zaten var: ADR-033 ödeme-void (admin+cashier) → void sonra iptal. **Bu kısıt role bağlı DEĞİL** — admin de aynı kapıdan geçer (veri bütünlüğü > kolaylık; öncelik #2).

**K4 — `merged` terminal statü guard'a eklenir.** `cancelOrderTx` reddi `paid|cancelled|void` → `TERMINAL_ORDER_STATUSES` (`+merged`). Mevcut latent hata; iptal yetkisi genişlerken kapanmalı. Aynı gerekçeyle iptal edilen adisyon **birleştirme hedefi** ise (yani halen `open`) iptal SERBESTtir — birleşmiş adisyonun tamamı iptal olur, bu doğru davranıştır (kalemler tek adisyonda toplandı).

**K5 — Mutfağa gitmiş kalem iptali engellenmez.** `status!=='new'` kalemler de iptal edilir; iptal fişinin varlık sebebi budur (ADR-004 Amd6). Engellemek "müşteri gitti" senaryosunu çözümsüz bırakırdı. Emniyet, engel değil **görünürlük**: onay ekranında "N ürün mutfağa gitti" uyarısı + mutfak iptal fişi + kasa kopyası + audit.

**K6 — ~~Garson ABAC'ı: yalnız `order_type='dine_in'`~~ → DÜŞTÜ (İlhan kararı, 2026-07-20).** Ürün sahibi "paket de iptal edebilsin" dedi → **sipariş türü kısıtı YOKTUR**; garson `dine_in`, `takeaway` ve `delivery` adisyonlarının hepsini iptal edebilir. Tek kapı K3'tür (aktif ödeme yoksa iptal serbest).

Özgün gerekçe (mobilde paket ekranı yok, paket iptali kasa/müdür işidir) kayda geçer ama **reddedildi**: garson paket siparişini mobilde göremese de masa tahtasından erişemediği bir kaydı iptal etmesi zaten pratikte gerçekleşmez; kısıt koymak route'a ölü kod eklerdi. Route seviyesinde `order_type` ABAC'ı **yazılmaz**; handler yine `order_type`'a göre `cancelOrderTx` / `cancelTakeawayOrder` dallanır (K9) — bu yönlendirme, yetkilendirme değil.

**K7 — Sebep: ön-tanımlı liste, serbest metin YOK.** `reason` alanı zod enum: `customer_left` (Müşteri gitti) · `wrong_table` (Yanlış masa) · `wrong_order` (Yanlış sipariş) · `test_entry` (Deneme/hatalı kayıt) · `other` (Diğer).
- **API'de opsiyonel-nullable** (web'in mevcut PATCH yolunu kırmamak için), **mobil UI'da ZORUNLU** (seçim yapılmadan "İptal Et" butonu pasif).
- Serbest metin **reddedildi**: (a) yoğun saatte klavye = akış kesintisi, (b) KVKK — serbest alana müşteri adı/telefonu yazılır, denetim kaydı PII'ye bulaşır.
- Sebep **enum kodu** olarak audit'e yazılır. (Kasa fişi K10 ile düştüğü için Türkçe etiket **hiçbir fişe basılmaz**; etiket yalnız mobil arayüzde ve rapor/denetim okumasında kullanılır.)
- **İlhan onayı 2026-07-20:** 5 seçenek yeterli bulundu, serbest metin istenmedi.

**K8 — Mobil UI.** `TableActionKind`'a `cancelOrder` eklenir; `FAZ_A_TABLE_ACTIONS` listesinin **en sonuna**, ayırıcı çizgiyle ve **yıkıcı stille** (kırmızı ikon `close-circle-outline` + kırmızı etiket) konur. `actions.ts` modül-başı yorumundaki "ASLA" listesinden `cancelOrder` **çıkarılır**, yerine "ADR-027 Amd2 (2026-07-20): cancelOrder AÇILDI — para kapısı K3 + sebep K7; comp ve assignCustomer KAPALI KALIR" yazılır.
**Onay akışı — çift onay DEĞİL, tek "sebep ekranı":** sheet'ten seçilince tam-genişlik onay adımı açılır: başlık "Masa N adisyonunu iptal et", altında ürün sayısı + tutar + (varsa) "N ürün mutfağa gitti" uyarısı, sonra **sebep chip'leri** (≥44pt), en altta kırmızı "İptal Et" (sebep seçilene kadar pasif) + "Vazgeç". Gerekçe: ADR-027 K3 "hafif onay dialog'u" kararıyla uyumlu; sebep seçimi zaten ikinci bilinçli dokunuş = çift onaydan daha iyi (kasıt kanıtı üretir, boş "Emin misiniz?" üretmez). Başarı → `onPaid()` tetiklenir (masa boşaldı, Order ekranı geri gider — `mergeTable` emsali).

**K9 — Kanonik iptal ucu: `POST /orders/:id/cancel` dine-in'i de üstlenir; `PATCH /orders/:id` garsona AÇILMAZ.** Handler `order_type`'a göre dallanır: `dine_in` → `cancelOrderTx`, `takeaway|delivery` → `cancelTakeawayOrder`. `authorize(['admin','cashier','waiter'])` + K6 ABAC + body `{reason?}`.
`PATCH /orders/:id` **olduğu gibi kalır** (`admin,cashier`) çünkü `status:'paid'` dalı Mod B "Masayı Kapat" (para toplamadan kapatma) — garsona asla açılamaz; ikili amaçlı route'u role göre iç-dallandırmak (rol kontrolünü handler gövdesine gömmek) reddedildi (parite testi ifade edemez, gözden kaçar). PATCH'in iptal dalı **deprecated** işaretlenir (web v5.1'de kanonik uca geçer); iki yol da aynı `cancelOrderTx` + aynı audit'i kullandığı için davranış ayrışması olmaz.
**Parite kaydı** (`rbac-parity.test.ts`): `POST /:id/cancel` satırı `roles: ['admin','cashier','waiter']` olur, `action: 'orders.cancel'` kalır; `PATCH /:id` satırı `action: null` + notu güncellenir ("Mod B masayı-kapat + deprecated iptal dalı — waiter HARİÇ, parasal").

**K10 — ~~İptal fişi kasa kopyası~~ → TAMAMEN DÜŞTÜ (İlhan kararı, 2026-07-20).**

Ürün sahibi ilk istekte "kasaya da iptal fişi çıksın" demişti; seçenekler önüne konunca kararını netleştirdi: *"kasadan iptal fişi çıkmasına gerek yok, yalnızca ilgili mutfak yazıcısından çıkmalı — fırın veya ızgara."*

→ **`enqueueCancelJob` DEĞİŞMEZ.** İstenen davranış zaten **aynı gün ADR-032 Amd1 K14 ile uygulandı**: iptal kalemleri `resolveItemStations()` ile gruplanıp her istasyonun kendi yazıcısına ayrı iptal fişi basılıyor (ızgara kaleminin iptali IZGARA'dan, fırın kaleminin iptali FIRIN'dan). Bu Amendment'ta iptal-fişi tarafında **yapılacak iş yoktur**.

Kayda geçer: kasa kopyası v5.1'de yeniden gündeme gelirse yeni bir karar gerekir (içerik/fiyat/PII soruları açık kalmıştır).

**K11 — ~~Kasa kopyasının içeriği (fiyatlı)~~ → K10 ile birlikte DÜŞTÜ.** `cancel-receipt.ts` **değişmez**; `copy` alanı, fiyat basımı, "İPTAL EDİLEN TUTAR / SEBEBİ / EDEN" satırları **yazılmaz**. Fiş içeriği bugünkü haliyle (fiyatsız mutfak fişi) kalır.

**Yine de kayda değer bulgu (uygulama tuzağı — başka bir iş bu tutarı basmak isterse):** `cancelOrderTx` `orders.total_cents = 0` yazar ve fiş enqueue'su tx'ten SONRA çalışır → **iptal tutarı `orders.total_cents`'ten OKUNAMAZ**; `order_items.total_cents` snapshot'larının toplamından hesaplanmalıdır (kalemler soft-cancel, tutar kolonları yerinde kalır).

**K12 — Denetim izi (ADR-024).** `order.cancelled` event'i korunur (yeni event türü yok), payload genişler: `{order_id, auto, reason, item_count, cancelled_total_cents}`. `ALLOWED_KEYS['order.cancelled']` = `['order_id','auto','trigger_item_id','reason','item_count','cancelled_total_cents']`. `reason` **enum kodu** (serbest metin yok → PII riski yok). Aktör `req.user.userId` (garson artık aktör olabilir). Audit yazımı `cancelOrderTx` ile **aynı transaction**ta kalır (ADR-024 Amd1 K1). Otomatik iptal (`auto:true`) yolunda `reason` null.

**K13 — Realtime/KDS değişmez.** `emitTenant(tenantId,'orders.cancelled',{orderId})` yeterli (masa tahtası + KDS invalidate zaten bunu dinliyor). Yeni event/kanal yok.

### Değerlendirilen alternatifler (reddedilenler)

- **Sahiplik-ABAC (yalnız kendi açtığı adisyon)** — RED, K1 (masa-devri kararıyla çelişir · diğer aksiyonlarla tutarsız · mobil `user` kalıcı değil).
- **`PATCH /orders/:id`'yi garsona aç, gövdede `status==='paid' && role==='waiter'` → 403** — RED: rol kontrolü route guard'ından handler gövdesine kaçar; `rbac-parity.test.ts` bunu ifade edemez → yetki modeli testsiz kalır. Garsonun "para almadan masa kapatma" yüzeyine bir `if`'lik mesafede olması kabul edilemez.
- **Yalnız admin kalsın + garsona "iptal talebi" bildirimi** — RED: yeni bildirim/onay kuyruğu domain'i (kapsam patlaması), ürün sahibinin talebini karşılamıyor, yoğun saatte admin telefonuna bakmıyor.
- **Garsona aç ama PIN/müdür şifresi iste** — RED: ADR-027 K3'te PIN zaten reddedildi (UX yavaşlatır, cihaz eşleştirme v5.1). Sebep-seçimi + kasa fişi + audit yeterli caydırıcı.
- **Kasa kopyası HER iptalde (kalem dahil)** — RED (v5.0): kağıt kirliliği + yoğun saatte kasa yazıcısı kuyruğu. K10'da açık bırakıldı.
- **Kasa kopyası mutfak fişiyle birebir aynı (fiyatsız)** — RED: kasa kopyasının varlık sebebi finansal kontrol; tutarsız fiş "ne kadar para uçtu" sorusuna cevap vermez.
- **Sebep serbest metin** — RED: KVKK (serbest alana müşteri adı/telefon yazılır) + mobilde klavye yoğun saatte akış kesintisi.
- **Sebep hiç sorulmasın (yalnız audit)** — RED: garson iptali açılırken tek düşük-maliyetli kontrol bu; "kim" biliniyor ama "neden" bilinmiyorsa gün-sonu denetim işe yaramaz.
- **Yeni ayrı `order.cancel_reason` audit event'i** — RED: tek olayın iki kaydı; ADR-024 kanonik payload genişletmesi daha temiz.

### Sonuçlar

- (+) "Müşteri gitti / yanlış masaya girdim" garsonun elinde çözülür → kasaya koşma ortadan kalkar (ADR-027 K1'in asıl gerekçesinin tamamlanması).
- (+) **İki bugün-var-olan hata kapanır**: kısmi ödenmiş adisyonun iptal edilip `payments` satırlarının öksüz kalması (K3) ve `merged` adisyonun iptale çevrilebilmesi (K4).
- (+) Matris ile route'lar **gerçekten** hizalanır: kasiyerin dine-in iptali artık matriste görünür (bugün "yok" yazıp yapabiliyordu).
- (+) Kasa kopyası + zorunlu sebep + audit = işletme sahibi için **fiziksel + dijital çift denetim izi**; Toast/Menulux "void reason" desenine yaklaşır.
- (+) İptal fişi istasyon yönlendirmesi (ADR-032 Amd1 K14) **hiç değişmez**; kasa kopyası ona ek bir job olarak biner (regresyon yüzeyi dar).
- (−) **Yetki genişlemesi geri alınamaz nitelikte**: garson artık adisyon iptal edebilir; kötüye kullanım "engellenmiş" değil, "görünür kılınmış"tır (aşağı Riskler).
- (−) `PATCH /orders/:id` iptal dalı **deprecated ama canlı** → iki iptal yolu bir süre birlikte yaşar (web geçene kadar); okuyucuya ek bilişsel yük, ADR bunu açıkça işaretliyor.
- (−) Kasa yazıcısına yeni bir iş türü biner → yoğun saatte kasa kuyruğu bir miktar artar (yalnız adisyon iptali; K10 ile sınırlandı).
- (−) `ORDER_HAS_PAYMENTS` (K3) yeni bir "yapamıyorum" durumu üretir: kısmi ödeme alınmış masayı iptal etmek isteyen garson admin/kasiyere gitmek zorunda (önce ödeme void). Bilinçli ödünleşim: veri bütünlüğü > kolaylık.
- (−) ADR-034 B2 aynı ayın kararıydı ve geri alınıyor → karar-geçmişi okuyucusu için kafa karıştırıcı; bu Amendment ilişkisi açıkça yazıyor.

### Riskler (ürün sahibi riski bilerek aldı — kayda geçiyor)

| # | Senaryo | Kalan kontrol |
|---|---|---|
| R1 | Garson müşteriden **nakit alır**, ödeme girmez, adisyonu iptal eder → para cebe | Kasa iptal fişi (tutar+sebep+kim, K10/K11) fiziksel olarak kasada belirir · `order.cancelled` audit · gün-sonu iptal listesi. **Teknik engel YOK** — nakit hiç sisteme girmediyse sistem bilemez. Bu, ADR-027'nin ödeme yetkisini açarken aldığı riskle aynı sınıf. |
| R2 | Ödeme alınmış adisyonu iptal etme | **Teknik olarak engellendi** (K3, tüm roller) |
| R3 | Mutfağa gitmiş ürünler iptal edilir, ürün çöpe/zayi | Engellenmez (K5) — mutfak iptal fişi + kasa kopyası + "N ürün mutfağa gitti" uyarısı; zayi maliyeti gün-sonu iptal raporunda görünür |
| R4 | Kaza eseri iptal (yanlış dokunuş) | Sebep seçimli onay ekranı (K8), yıkıcı stil, listenin en altı + ayırıcı |
| R5 | Sebep hep "Diğer" seçilir → denetim değeri düşer | Kabul edilen artık risk; gün-sonu rapor "Diğer" oranını görünür kılar (v5.1) |
| R6 | Baskı başarısız olur, kasa kopyası hiç çıkmaz | İptal fişi **best-effort** (Amd6 A7 — iptali rollback etmez); asıl kanıt audit'tir, kağıt ikincil kontroldür |

### Kapsam kilidi — v5.0'da NE YOK

- İptal edilmiş adisyonu **geri alma / reopen** (yalnız ödeme-void reopen'ı var, ADR-033) — v5.1.
- **İptal raporu ekranı** (gün-sonu "kim kaç iptal yaptı / sebep dağılımı") — v5.1 backlog; veri (audit) bugünden birikir.
- **Kalem iptalinin kasa kopyası** — K10; v5.1 opsiyonu.
- **Web'de sebep seçimi** — v5.0'da yalnız mobil sorar; web PATCH yolu sebepsiz devam eder (v5.1'de web kanonik uca taşınır + sebep alır).
- **Serbest metin sebep**, **iptal onay/yetkilendirme kuyruğu**, **PIN/müdür şifresi**, **iptal limiti (günde N)**, **zayi/stok düşümü** — hiçbiri v5.0'da yok.
- **`comp` (ikram) ve `assignCustomer` garsona KAPALI KALIR** (ADR-027 K2'nin bu iki maddesi yürürlükte).

### Definition of Done (implementer — bu Amendment Accepted olduktan SONRA)

- [ ] `permissions.ts`: `orders.cancel` → `waiter` + `cashier` setlerine eklenir; ADR-034 B2 yorumu **güncellenir** (kaldırıldı→geri kondu, gerekçe + tarih 2026-07-20); `orders.cancel` satırına ABAC notu (garson yalnız `dine_in`, K6).
- [ ] `packages/db/.../orders.ts` `cancelOrderTx`: terminal reddi `TERMINAL_ORDER_STATUSES` (`+merged`, K4) + **aktif ödeme kapısı** (`SUM(amount_cents) WHERE voided_at IS NULL > 0` → `RepositoryError('check','ORDER_HAS_PAYMENTS')`, K3), `FOR UPDATE` kilidi içinde.
- [ ] `apps/api/src/routes/orders.ts`: `POST /:id/cancel` → `authorize(['admin','cashier','waiter'])`, `order_type` dallanması (dine_in→`cancelOrderTx` / takeaway→`cancelTakeawayOrder`), garson+non-dine_in → `403 AUTH_FORBIDDEN` (K6), body `{reason?}` zod enum (K7), audit payload genişler (K12); `409 ORDER_HAS_PAYMENTS` map'i + Türkçe mesaj (`errors.ts`). `PATCH /:id` iptal dalı **deprecated** yorumu + audit'e `reason: null`.
- [ ] `allowed-keys.ts`: `order.cancelled` whitelist `+reason, +item_count, +cancelled_total_cents`; `audit-coverage.test.ts` beklentisi güncellenir.
- [ ] `rbac-parity.test.ts`: `POST /:id/cancel` rolleri + `PATCH /:id` notu (K9); parite yeşil.
- [ ] `enqueue-cancel-job.ts`: `variant==='order-cancel'` ise istasyon döngüsünden sonra **tek** `kind:'bill'` job (K10); kalem fiyat kolonları (`unit_price_cents`,`total_cents`) yalnız kasa kopyası için SELECT'e eklenir; tutar **kalem toplamından** (K11 tuzağı); `reason`+`actorName` ctx'e eklenir. İstasyon gruplaması ve mutfak fişi **byte-düzeyinde değişmez**.
- [ ] `cancel-receipt.ts`: `copy: 'kitchen'|'cashier'` dallanması; kasa kopyasında fiyat sütunu + "İPTAL EDİLEN TUTAR" + "İPTAL SEBEBİ" + "İPTAL EDEN"; **müşteri PII YOK**; raster (Amd9) yolunda kalır.
- [ ] Mobil: `TableActionKind` `+cancelOrder` + `FAZ_A_TABLE_ACTIONS` sonuna; `actions.ts` "ASLA" listesi güncellenir (K8); `TableActionSheet` yıkıcı stil + ayırıcı; `CancelOrderSheet` (sebep chip'leri + uyarı + pasif buton) `TableActionsController`'a `step:'cancelOrder'` olarak bağlanır; başarı → toast + `onPaid()`.
- [ ] i18n `tr`: `order.actions.cancelOrder`, `order.cancel.title/warning/confirm/success/error`, `order.cancel.reason.*` (5 etiket), `error.ORDER_HAS_PAYMENTS`. **Hardcoded string yok.**
- [ ] Test: (a) RBAC — waiter dine_in cancel 200 / waiter takeaway cancel 403 / kitchen 403; (b) K3 — kısmi ödemeli adisyon 409 `ORDER_HAS_PAYMENTS` (aktif) + void'lenmiş ödemede 200; (c) K4 — `merged` adisyon 409; (d) audit satırı `reason`/`item_count`/`cancelled_total_cents` ile yazılır; (e) print — order-cancel'da `kind:'bill'` job **1 adet** + istasyon job'ları bozulmadan; item-cancel'da bill job **0 adet**; (f) kasa fişi render smoke (tutar>0, sebep satırı, PII yok).
- [ ] **security-reviewer ZORUNLU** (authorization genişlemesi + parasal etki) · **db-migration-guard** (migration YOK — teyit) · **hci-reviewer** + **turkish-ux-reviewer** (yıkıcı aksiyon + sebep ekranı) · i18n gate.
- [ ] **MIGRATION YOK** · `print_jobs.payload` şekli AYNI · **print-agent exe DEĞİŞMEZ** (kasa agent'ı `bill` kind'ını zaten claim ediyor) — doğrula.
- [ ] Deploy: API + web etkilenmez; **mobil yeni APK (EAS)** gerekir. Fiziksel smoke [USER]: dükkan-PC'de bir test adisyonu garson hesabıyla iptal → mutfak fişi + **kasa fişi kağıtta** doğrulanır.
- [ ] `any` yok; strict geçer; cerrahi (yalnız whitelist dosyalar); tam suite + CI yeşil.

### Açık sorular (İlhan onayı bekliyor)

1. **K6** — Garson **paket/takeaway** adisyonunu da iptal edebilsin mi? (Öneri: hayır; mobilde paket ekranı yok.)
2. **K10** — Kasa kopyası **yalnız adisyon iptalinde** mi çıksın, yoksa **kalem iptalinde de** mi? (Öneri: yalnız adisyon; orta yol: yalnız mutfağa gitmiş kalemin iptali.)
3. **K3** — Kısmi ödenmiş adisyonu **admin de** iptal edemeyecek (önce ödeme void). Onaylıyor musun? (Öneri: evet — veri bütünlüğü.)
4. **K7** — Sebep listesi 5 seçenek yeterli mi, eklemek/çıkarmak istediğin var mı?

<!-- ADR-027 Amendment 2 PROPOSED (2026-07-20) — MOBİL SİPARİŞ İPTALİ (garsona açılır) + İPTAL FİŞİ KASA KOPYASI. Ürün sahibi (İlhan 2026-07-20): 3-nokta menüsüne "Siparişi iptal et" + GARSON DA İPTAL EDEBİLİR + iptal fişi KASA yazıcısından da çıkar. GERİ ALINAN: ADR-027-K2 "iptal garsona ASLA" · ADR-008-§7c "garson iptal yok" · ADR-034-B2(2026-07-12) "orders.cancel kasiyerden KALDIRILDI" · mobil actions.ts "ASLA: cancelOrder". KOD-GERÇEĞİ(doğrulandı): iki iptal yolu — POST /orders/:id/cancel admin-only+YALNIZ-takeaway(cancelTakeawayOrder) · PATCH /orders/:id {status:'cancelled'} admin+cashier=DİNE-İN-İPTAL(cancelOrderTx) → KASİYER ZATEN İPTAL EDEBİLİYOR ama matris "yok" diyor (parite testi action:null ile tolere ediyor); PATCH İKİLİ-AMAÇLI (status:'paid'=Mod-B-Masayı-Kapat, para-almadan-kapatma) → garsona AÇILAMAZ. cancelOrderTx guard yalnız paid|cancelled|void → (a) KISMİ-ÖDENMİŞ adisyon iptal edilebiliyor, payments öksüz kalıyor+total_cents=0 (b) 'merged' reddedilmiyor. İptal fişi bugün(ADR-032-Amd1-K14) istasyona-gruplu kind=kitchen/grill, FİYATSIZ(A3), KASA KOPYASI YOK. Mobil auth.user hydrate'te NULL kalıyor. KARARLAR: K1-SAHİPLİK-ABAC-REDDEDİLDİ(ana-context-önerisi): ADR-025-K4/ADR-008-Amd-2026-06-28 own-only-filtreyi-ZATEN-KALDIRMIŞTI(masa-devri) · garson zaten başkasının masasında ödeme alıyor/yazdırıyor/taşıyor · mobil user=null(soğuk-başlatma)→istemci sahipliği hesaplayamaz. K2-orders.cancel matrise waiter+cashier eklenir (kasiyer zaten yapıyordu; ADR-034-B2 AÇIKÇA GERİ ALINIR); kitchen HARİÇ. K3-PARA-KAPISI(asıl daraltma): aktif ödeme(SUM WHERE voided_at IS NULL>0) varsa iptal YASAK 409 ORDER_HAS_PAYMENTS — TÜM ROLLER(admin dahil); bugünkü öksüz-payments açığını da kapatır; düzeltme yolu ADR-033 ödeme-void. K4-'merged' TERMINAL_ORDER_STATUSES guard'a eklenir. K5-mutfağa-gitmiş-kalem iptali SERBEST(fişin varlık sebebi)+onayda "N ürün mutfağa gitti" uyarısı. K6-garson ABAC yalnız dine_in(mobilde paket ekranı yok). K7-SEBEP ön-tanımlı enum(customer_left/wrong_table/wrong_order/test_entry/other) API-opsiyonel-mobil-ZORUNLU; serbest-metin RED(KVKK-PII+klavye-yavaşlık). K8-MOBİL-UI: TableActionKind+cancelOrder, listenin EN SONU+ayırıcı+yıkıcı-kırmızı-stil; ASLA-listesi güncellenir; ÇİFT-ONAY-DEĞİL tek "sebep ekranı"(ürün-sayısı+tutar+mutfak-uyarısı+sebep-chip'leri+pasif-kırmızı-buton) ADR-027-K3-hafif-onay uyumlu; başarı→onPaid(). K9-KANONİK-UÇ POST /orders/:id/cancel dine-in'i de üstlenir(order_type-dallanma) authorize[admin,cashier,waiter]; PATCH /orders/:id GARSONA AÇILMAZ(paid-dalı=para-almadan-kapatma) ve iptal-dalı DEPRECATED; rol-kontrolünü-handler-gövdesine-gömme RED(parite-testi ifade edemez). K10-KASA-KOPYASI yalnız ADİSYON-İPTAL, istasyon-döngüsünden-sonra TEK ek job kind:'bill' meta.copy='cashier', BÖLÜNMEZ; KALEM-İPTAL kasaya BASMAZ(v5.0 kağıt-kirliliği). K11-kasa-kopyası FİYATLI: copy:'kitchen'|'cashier' dallanması(Amd5-K1-emsali) + İPTAL-EDİLEN-TUTAR + İPTAL-SEBEBİ + İPTAL-EDEN; müşteri-PII YİNE YOK; TUZAK: cancelOrderTx orders.total_cents=0 yazar+enqueue tx-SONRASI → tutar order_items.total_cents TOPLAMINDAN. K12-AUDIT order.cancelled korunur payload+reason,+item_count,+cancelled_total_cents; ALLOWED_KEYS genişler; aynı-tx(ADR-024-Amd1-K1). K13-realtime/KDS değişmez. ALTERNATİF-RED: sahiplik-ABAC · PATCH'i-garsona-aç+gövdede-403 · admin-only+iptal-talebi-bildirimi · PIN/müdür-şifresi(ADR-027-K3'te zaten RED) · her-iptalde-kasa-kopyası · fiyatsız-kasa-kopyası · serbest-metin-sebep · sebep-sorma. RİSKLER(ürün-sahibi-bilerek-aldı): R1-garson-nakit-alır-girmez-iptal-eder=TEKNİK-ENGEL-YOK(kasa-fişi+audit+gün-sonu görünürlük; ADR-027-ödeme-yetkisiyle aynı risk-sınıfı) · R2-ödenmiş-iptal=ENGELLENDİ(K3) · R3-mutfak-zayi=görünürlük · R4-yanlış-dokunuş=sebep-ekranı · R5-hep-"Diğer" · R6-baskı-başarısız(best-effort-Amd6-A7, asıl-kanıt-audit). KAPSAM-KİLİDİ-v5.0'DA-YOK: iptal-geri-alma/reopen · iptal-raporu-ekranı(v5.1, veri bugünden birikir) · kalem-iptali-kasa-kopyası · web'de-sebep · serbest-metin · onay-kuyruğu · PIN · günlük-iptal-limiti · zayi/stok; comp+assignCustomer GARSONA KAPALI KALIR. DoD: permissions+cancelOrderTx-guard(K3/K4)+route(K6/K7/K9)+allowed-keys+rbac-parity+enqueue-cancel-job(K10)+cancel-receipt-copy(K11)+mobil(K8)+i18n+6-test-grubu+security-reviewer-ZORUNLU+hci/turkish-ux+MIGRATION-YOK+exe-DEĞİŞMEZ+yeni-APK-EAS+fiziksel-kağıt-smoke. AÇIK-SORULAR[İlhan]: (1)garson-paket-iptali? (2)kasa-kopyası-kalem-iptalinde-de? (3)admin-de-kısmi-ödenmişi-iptal-edemesin-onay? (4)sebep-listesi-5-yeterli? -->
