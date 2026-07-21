## ADR-032 Amendment 3 — Paket Sipariş Fiş Akışı: İstasyon Bölünmesi Paket'e Açılır + Kasadan Otomatik Paket Fişi + Mutfak Fişinden Fiyat Kalkar

- **Durum**: **Proposed (2026-07-21)** — ürün sahibi İlhan'ın onayı bekleniyor (5 açık madde raporda).
- **Tarih**: 2026-07-21
- **İlişki**: **ADR-032 Amendment 1 K4b'yi GERİ ALIR** (Layout B bölünmez kararı) ve **K16'yı Layout B'ye genişletir**. **ADR-004 Amd5 K4/K7'yi KISMEN SUPERSEDE eder** (Layout B fiyat/TUTAR kolonu + müşteri bloğu kapsamı). Bağlı ve **DEĞİŞMEZ**: ADR-004 §5 (1 agent = 1 yazıcı) · ADR-004 Amd4 (spooler-RAW transport) · ADR-004 Amd6 (iptal fişi — zaten doğru, K10) · ADR-004 Amd9 (raster render) · ADR-027 Amd1 (kasa adisyon fişi — dokunulmaz) · ADR-020 K2 (`kitchen_print` = KDS otoritesi) · ADR-024 (`payload.meta` PII-safe) · ADR-031 (cutover 24-26 Tem). **Amd2** (`adr-032-amd2-yazici-yonetimi.md`, PR #411 yazıcı yönetim ekranı) bu Amendment'tan bağımsızdır.
- **Kapsam (dosya)**: `apps/api/src/print/enqueue-kitchen-job.ts` (koşul kaldırma + SELECT sadeleşmesi) · `apps/api/src/print/templates/kitchen-receipt.ts` (fiyat kaldırma + K16 Layout B + müşteri bloğu daraltma) · `apps/api/src/print/templates/packing-receipt.ts` (**YENİ**) · `apps/api/src/print/enqueue-packing-job.ts` (**YENİ**) · `apps/api/src/routes/orders.ts` (takeaway POST'a tek çağrı) · ilgili testler. **DOKUNULMAYAN:** `packages/db/migrations/` · `packages/shared-types/` · `apps/print-agent/` · `apps/web/` · `apps/mobile/` · `apps/api/src/print/enqueue-cancel-job.ts` · `apps/api/src/print/enqueue-bill-job.ts` · `apps/api/src/print/resolve-item-stations.ts` · `apps/api/src/routes/kds.ts`.

### Neden ADR-032 Amendment (ADR-004 tarafı veya yeni ADR değil)

Amd5/6/7 kriteri: **yeni server/cross-service runtime kontratı** (endpoint · migration · `payload` şeması · agent claim semantiği) getiren → yeni ADR; getirmeyen → amendment. Bu iş hiçbirini getirmiyor: yeni endpoint yok, **migration yok** (`categories.print_station` Migration 048'de zaten var), `payload` şekli (`{kind, meta, bytesBase64}`) aynı, `PrintJobKindSchema` **genişlemiyor** (`bill` yeniden kullanılıyor — K12/8), print-agent exe/config **dokunulmuyor**.

ADR-032 tarafı olmasının gerekçesi: ADR-032'nin konusu **yönlendirmedir** ("hangi fiş hangi fiziksel yazıcıdan çıkar") ve ürün sahibinin üç şikâyeti de yönlendirme şikâyetidir. Kararların ağırlık merkezi Amd1 K4b'nin **doğrudan revizyonudur**; kilidi koyan belgeyle iptal eden belgenin aynı ADR ailesinde durması izlenebilirliği tek yerde tutar.

**Karşı-argüman kayda geçer:** K3 (fiyat kaldırma) ve K14 (müşteri bloğu daraltma) fiş **içeriği** kararlarıdır ve ADR-004 Amd5'in alanına girer; K4 (yeni `packing-receipt` şablonu) ADR-004 §7 "saf-render şablon ailesi"ne bir üye ekler. İlhan tercih ederse bu Amendment ikiye bölünebilir (ADR-032 Amd3 = yönlendirme; ADR-004 Amd10 = fiş içeriği). **Bölmemeyi öneriyorum:** K3, K1'in ÖN KOŞULUDUR (aşağıda) — ayrı belgelere konursa aralarındaki zorunlu bağ görünmez olur ve biri diğeri olmadan uygulanabilir hale gelir. Tek belge, bağı zorunlu kılar.

---

### Bağlam

**Canlı bulgu (2026-07-21).** ADR-032 Amd1 (mutfak istasyon yönlendirmesi) prod'a alındı ve **masa siparişlerinde** uçtan uca doğrulandı (fiş ikiye bölündü: `grill 1/2` + `kitchen 2/2`). Ardından ürün sahibi bir **paket sipariş** girdi ve üç şikâyet bildirdi:

1. Sipariş oluşturulunca **kasa yazıcısından fiş çıkmadı**.
2. Kategori→yazıcı ataması paket siparişte çalışmıyor.
3. Paket siparişte hem ızgara hem fırın ürünü vardı; **ızgara ürünü FIRIN'dan çıktı, IZGARA'dan hiç fiş çıkmadı**.

**DB kanıtı (prod):** paket sipariş → **tek** `kind=kitchen` job, `groupIndex 1/1`, `itemCount=3`. Masa siparişleri doğru bölünüyor.

**Kök neden (2+3) — kod-teyitli.** `apps/api/src/print/enqueue-kitchen-job.ts:201-205`:
```ts
order.order_type === 'dine_in'
  ? [...(await resolveItemStations(db, ctx.tenantId, sentItemIds))].map(...)
  : [{ station: DEFAULT_KITCHEN_STATION, itemIds: sentItemIds }];
```
Bu, **ADR-032 Amd1 K4b'nin bilinçli kararıdır**. Gerekçesi iki ayaklıydı: (i) Layout B sipariş-**seviyesi** alanlar basıyor (`total_cents`, müşteri adı/telefon/adres/ödeme) → bölünürse her istasyon fişinde **tam sipariş tutarı** tekrarlanır ve kalem-toplamıyla **çelişir**; (ii) müşteri PII'si her fişte tekrarlanır. Ek gerekçe: "şikâyet zaten salon mutfağıydı" + cutover'a 3 gün kala gereksiz iş.

**Gerekçe teknik olarak sağlamdı; dayandığı iki varsayım bugün yanlışlandı:**
- "Şikâyet salon mutfağıydı" → ürün sahibi bugün paket için de talep etti.
- "Tutar çelişkisi kaçınılmaz" → ürün sahibi bugün **mutfak fişinde tutar istemiyor** (K3). Fiyat kalkınca çelişki **yapısal olarak yok olur**.

**Kök neden (1) — kod-teyitli.** `enqueueBillJob` yalnız iki yerde çağrılıyor: `POST /orders/:id/print-bill` (`orders.ts:786`, manuel) ve ödeme sonrası (`payments.ts:209`). Sipariş oluşturma **hiçbir türde** kasa fişi bastırmıyor. Ayrıca paket siparişin ödemesi `payments.ts` üzerinden değil, `PATCH /orders/:id/takeaway-stage` → `delivered` geçişinde tx-içi `updateTakeawayStage` ile yazılıyor (`orders.ts:844-884`) → **o yolda da `enqueueBillJob` çağrılmıyor**. Yani **paket siparişte kasa yazıcısından hiçbir aşamada fiş çıkmıyor**; eksik değil, **hiç yapılmamış** bir davranış.

**Bugünkü fiili durum (kâğıt üstünde).** Paket siparişte kurye slip'i görevini **mutfak fişi (Layout B)** görüyor: FIRIN yazıcısından çıkan tek fişte müşteri adı/telefon/adres/ödeme + kalemler + TUTAR var. Yani mimari kaza eseri çalışıyor — ama **yanlış yazıcıdan** ve **ızgara kalemleri kimseye görünmeden**.

**Sessiz canlı tutarsızlık (bu incelemede bulundu, kod-teyitli).** `enqueue-cancel-job.ts:131-135` `resolveItemStations`'ı **KOŞULSUZ** çağırıyor — `dine_in` kısıtı YOK (Amd1 K14 kasten böyle yazdı). Sonuç: **paket siparişte ızgara ürününün SİPARİŞ fişi FIRIN'dan çıkıyor, ama İPTAL fişi IZGARA'dan çıkıyor.** Izgaracı, hiç görmediği bir ürünün iptal fişini alıyor; fırıncı ise iptali hiç görmüyor ve pişirmeye devam ediyor. Bu, K4b'nin tek başına yarattığı bir **veri-bütünlüğü sınıfı hata**dır ve bugün prod'da canlıdır.

**Operasyonel ağırlaştırıcı (Amd1 K11 notu).** Izgara istasyonunda **KDS ekranı YOK, yalnız kâğıt**. Yani paket siparişte ızgaracının emniyet ağı sıfır: fiş çıkmazsa ürünü hiçbir yerden göremez.

### v3 referansı (`D:\dev\restoran-pos-v3\`, READ-ONLY — kendi cümlelerimle)

v3'ün paket akışını taradım. Dört bulgu, dördü de bu Amendment'ın kararlarını destekliyor:

1. **v3 istasyon bölünmesini sipariş türüne göre kısıtlamıyordu.** Mutfak fişi üretimi kalemleri çözümlenen yazıcıya göre grupluyor ve her yazıcı için ayrı job yazıyordu; gruplamada `order_type` hiç yer almıyordu (`server/services/printJobs.js:161-215`). Yani **paket siparişler v3'te de istasyona bölünüyordu** — K4b, v3'e göre bir gerilemeydi.
2. **v3 mutfak fişinde FİYAT YOKTU.** Mutfak fişi kalem bloğu yalnız "ÜRÜN / ADET" sütunlarını basıyor; satır tutarı ve genel toplam hiç yok (`store-bridge/printers/renderers.js:710-732`). Fiyat/TUTAR **v5'in Layout B ile getirdiği bir sapmaydı**; K3 v3 davranışına dönüştür.
3. **v3 mutfak fişinde istasyon adı basılıyordu** — başlık bloğunda köşeli parantez içinde istasyon etiketi, sipariş türünden bağımsız (`renderers.js:704`). K7 (K16'yı Layout B'ye açmak) v3 paritesidir.
4. **v3'te kasa tarafında iki ayrı olay vardı** (`server/services/printerAutoPrintPolicy.js:11-36`): paket siparişi **oluşturulunca** mutfak yazıcısına otomatik basım (`kitchen_takeaway_order_create`) ve paket **tamamlanınca** kasa/fiş yazıcısına otomatik basım (`receipt_takeaway_complete`). Ayrıca ayrı bir **"PAKET ETİKETİ"** render türü vardı: müşteri adı/telefon/adres taşıyan, kendi hedef yazıcısı ayarlanabilen, mutfak rolündeki bir yazıcıya giden bağımsız bir şablon (`printJobs.js:550-600`, `renderers.js:920-950`). Yani **v3 "üretim emri" ile "paketleme/kurye kâğıdı"nı ayrı şablonlar olarak modelliyordu** — K4'ün ayrı şablon tercihinin doğrudan emsali. Her basım noktası ayrıca yazıcı-başına aç/kapa anahtarına bağlıydı; v5.0'da bu ayar yok (K12/3).

**Not:** v3 kasa fişini **teslimde** basıyordu, oluşturmada değil. Ürün sahibi bugün **oluşturmada** istedi (paketleme kâğıdı olarak). Bu bilinçli bir v3 sapmasıdır ve K5'te gerekçelendirildi.

---

### Kararlar (K1–K15)

**K1 — İstasyon bölünmesi TÜM sipariş türlerine açılır; Amd1 K4b GERİ ALINIR.**
`enqueue-kitchen-job.ts:201-205`'teki `order.order_type === 'dine_in' ? ... : ...` üçlü koşulu **kaldırılır**; `resolveItemStations(...)` **koşulsuz** çağrılır — yani `enqueue-cancel-job.ts:131`'in bugünkü halinin birebir aynısı. Bu bir **kod ekleme değil, koşul silme** işidir; blast-radius tek ifade.
**Gerekçe:** (a) ürün sahibi kararı; (b) v3 emsali (yukarıda 1); (c) K4b'nin birinci ayağı (tutar çelişkisi) K3 ile **yapısal olarak** ortadan kalkıyor, ikinci ayağı (PII) K14 ile **azaltılıyor**; (d) sipariş fişi ile iptal fişi arasındaki canlı tutarsızlık (yukarıda) kapanıyor — iki yol tek kurala oturuyor; (e) ızgarada KDS yok → kâğıt tek emniyet ağı.
**K3 K1'in ÖN KOŞULUDUR:** K3 uygulanmadan K1 uygulanırsa, Amd1 K4b'nin uyardığı gerçek hata doğar (her istasyon fişinde tam sipariş tutarı, kalem toplamıyla çelişir). **İkisi aynı PR'da gider; K1'i K3'süz merge etmek YASAK.**

**K2 — Yerleşim (Layout) seçimi DEĞİŞMEZ.** `order_type === 'dine_in' → Layout A`, aksi → Layout B kuralı aynen kalır (`kitchen-receipt.ts:137-140`). **Bölünme ile yerleşim ortogonal boyutlardır:** bölünmüş bir paket siparişinin her parçası Layout B olarak render edilir. Amd1'in hatası bu iki boyutu tek koşulda birleştirmesiydi.
**Reddedilen:** "paket bölününce parçalar Layout A ile bassın" — reddedildi: paket fişinde işletme başlığı ve sipariş kanalı satırı mutfağın da işine yarar (masa fişiyle karıştırmamak için) ve Layout A "Masa" çapası paket siparişte "-" basar (anlamsız).

**K3 — Mutfak fişinden FİYAT ve TUTAR tamamen kaldırılır (Layout B).**
Layout B'nin kalem satırındaki tutar sütunu (`kitchen-receipt.ts:242`) ve `TUTAR` satırı (`:251`) **silinir**. Kalem satırı Layout A ile aynı biçime döner: `leftRight(ürün adı, adet+porsiyon)`.
**Gerekçe:** ürün sahibi kararı ("mutfak fişlerinde, paket veya masa farketmeksizin tutar bilgisi olmasına gerek yok") + v3 paritesi (yukarıda 2) + K1'in ön koşulu + mutfak personeli fiyat bilgisine ihtiyaç duymaz (gereksiz bilgi = gürültü) + para bilgisi mutfak kâğıdında dolaşmaz.
**"Masa farketmeksizin" ifadesi Layout A için no-op'tur:** Layout A **zaten** fiyat basmıyor (`:186-189` — yalnız ad + adet). Yani karar tek yerde, Layout B'de uygulanır. Bu kod-teyitlidir; "masa fişini de değiştirdik" izlenimi yanlıştır.
**Ölü parametre bırakılmaz (CLAUDE.md §7):** `KitchenReceiptItem.lineTotalCents` ve `KitchenReceiptParams.total_cents` **kaldırılır**; buna bağlı olarak `enqueue-kitchen-job.ts` SELECT'lerinden `order_items.total_cents` (`:88`) ve `orders.total_cents` (`:105`) düşer. `moneyDigits` import'u kitchen-receipt'te ölür → kaldırılır. **`moneyDigits` ve `rc.itemRow` helper'ları KALIR** — `bill-receipt.ts:131,158` ve `receipt-layout.ts:29` onları kullanıyor (kod-teyitli); kendi orphan'ımız değiller, dokunulmaz.

**K4 — Kasa paket fişi: YENİ `packing-receipt.ts` şablonu, `payload.kind='bill'` ile kasa yazıcısına.**
Sipariş oluşturulunca kasa yazıcısından çıkacak fiş **yeni bir saf-render şablonudur** (ADR-004 §7 kontratı: `params → Uint8Array`, IO yok). İçeriği bugünkü Layout B'nin **fiyatlı ve tam-PII'li** halidir: ortalı işletme başlığı + `PAKET SİPARİŞ` başlığı + yerel tarih-saat → Adisyon No / çalışan / sipariş kanalı → **Müşteri / Telefon / Adres / Tarif / Ödeme** (yalnız dolu alanlar) → kalemler (adet · ad · **tutar**) + modifiye/not → **TUTAR (₺)** → `AFİYET OLSUN`. Raster (Amd9) + buzzer (Amd8) zarfı aynen; `KITCHEN_TAIL_FEED_LINES` yerine kasa yazıcısının kesicisi olduğundan **`bill-receipt` kuyruk davranışı** taklit edilir.
**`kind='bill'` kullanılır, YENİ bir enum değeri EKLENMEZ.** Kasa agent'ının config'i `jobKinds:['bill']` (Amd1 K6 ile doğrulandı) → **agent'a, exe'ye, config'e, enum'a hiç dokunulmaz**. Yeni bir `packing` kind'ı eklemek exe rebuild + üç serviste copy-over + cutover riski demektir (Amd1 K7'nin tüm maliyeti); kazanımı yalnız "kasa fişleri ayrı sayılabilsin"dir ve bu `payload.meta.variant='packing'` ile bedelsiz elde edilir (`enqueue-cancel-job.ts:178` `meta.variant` emsali; meta agent-opaque'tir).

**Değerlendirilen ve REDDEDİLEN alternatifler (K4):**
- **(B) Mevcut `enqueueBillJob`'u (adisyon fişi) sipariş anında çağırmak.** **REDDEDİLDİ.** İki bağımsız sebep: (i) adisyon fişi **bilinçli PII-safe**'tir — `enqueue-bill-job.ts:14-15` ve `payments.ts:205` "müşteri PII SELECT bile edilmez — kasa fişi PII-safe (KVKK)"; kuryeye/paketlemeye giden fiş adres ve telefon ister → o fişi PII'li hale getirmek ADR-027 Amd1'in tasarım niyetini bozar ve **her ödeme fişine de PII taşır** (istenmeyen yan etki). (ii) Adisyon fişi ödeme dökümü + "Kalan" satırı basar; sipariş anında tahsil=0/kalan=tam tutar → müşteriye "kalan borç" izlenimi veren anlamsız satırlar. İki farklı amaçlı belge (hesap vs. paketleme kâğıdı) tek şablona sıkıştırılamaz.
- **(C) `renderKitchenReceipt` Layout B'nin kendisini `kind='bill'` ile kasaya da göndermek (bir `show_prices` bayrağıyla).** **REDDEDİLDİ.** K3 fiyatı **yapısal olarak** kaldırıyor; bayrak eklemek onu **koşullu** hale getirir — yani "mutfakta fiyat olmayacak" güvencesi bir boolean'ın doğru geçilmesine indirgenir. Implementer bayrağı ters geçerse mutfağa fiyat gider ve kimse fark etmez (fiş kâğıdı, test kapsamı dışı). Ayrıca aynı fonksiyon iki farklı belge üretmeye başlar → test matrisi ikiye katlanır, dosya adı (`kitchen-receipt`) yanıltıcı olur. v3 de bu ikisini ayrı render türleri olarak modellemişti (yukarıda 4). Maliyet farkı küçüktür: `ReceiptCanvas` primitifleri hazır, yeni dosya ~120 satır.
- **(D) Ayrı fiziksel "paket etiketi" yazıcısı (v3 `takeawayLabelPrinterId` emsali).** **REDDEDİLDİ** — dördüncü fiziksel yazıcı + dördüncü agent servisi + enum genişlemesi; ürün sahibi kasadan istedi. Kapsam kilidi (K12/6).

**K5 — Tetikleyici: yalnız paket siparişi OLUŞTURMA. Kalem-eklemede ve teslimde basılmaz.**
Çağrı noktası: `orders.ts` takeaway POST handler'ı, mutfak enqueue bloğundan **SONRA** (mutfak zaman-kritiktir, kuyruğa önce o girer), `findOrderById` detay dönüşünden önce.
**`kitchenItems.length > 0` guard'ının DIŞINDA, koşulsuz** çağrılır (`orders.ts:659` guard'ı yalnız mutfak yolunu sarmalar): yalnız içecek içeren bir paket siparişi de paketlenir ve teslim edilir; mutfak fişi olmasa da kasa fişi çıkmalıdır.
**Best-effort:** `try/catch` + `logger` ile sarmalanır; fiş üretilemezse **sipariş oluşturma başarısız olmaz** ve 201 döner (`orders.ts:987` cancel-job emsali). Fiş, siparişin doğruluk koşulu değildir.
**Kalem-eklemede (`PATCH /orders/:id/items`) yeniden BASILMAZ.** Gerekçe: iki farklı içerikli kâğıt dolaşıma girer, hangisinin geçerli olduğu belirsizleşir (paketleyici yanlış kopyaya bakabilir) + kâğıt israfı. Kasiyerin ihtiyacı olursa mevcut manuel "Yazdır" düğmesi (`POST /orders/:id/print-bill`) zaten var. Mutfak fişi bu durumda **basılmaya devam eder** (bugünkü davranış, `orders.ts:1351`) — mutfağın yeni kalemi görmesi zorunludur.
**Teslimde (`delivered`) kasa fişi basılmaz** — v3'te vardı (`receipt_takeaway_complete`), v5'te yok ve ürün sahibi istemedi → kapsam kilidi (K12/1). Sessiz kapsam büyümesi yasak.

**K6 — Veri çekimi: "tek-fetch otoritesi" (ADR-027 Amd1 / ADR-004 Amd5 K12 paritesi).**
`enqueuePackingJob(db, { orderId, tenantId, actorUserId })` — çağıran yalnız üç kimlik geçer; helper order + kalemler + modifiye seçenekleri + müşteri adı/telefonu + tenant başlığı + timezone'u **kendi çeker**. Gerekçe: `orders.ts` handler'ı zaten 200+ satır; oradaki değişiklik **tek satırlık çağrı** olarak kalır (cerrahi değişiklik kuralı) ve fetch mantığı üç enqueue helper'ında tek desende toplanır.
**`payload.meta` PII-safe kalır (ADR-024):** `{ orderId, orderNo, actorUserId, itemCount, totalCents, variant: 'packing', renderedAt }`. Müşteri adı/telefon/adres **meta'ya GİRMEZ** — yalnız `bytesBase64` içinde (fişin kendisi; kaçınılmaz). Bu, `enqueue-kitchen-job.ts:210-211`'de zaten uygulanan kuralın aynısıdır.

**K7 — K16 (istasyon etiketi + parça göstergesi) Layout B'ye de açılır.**
`station_label` ("FIRIN"/"IZGARA") ve `part_label` ("Fiş 1/2") bugün yalnız `buildLayoutA` içinde basılıyor (`kitchen-receipt.ts:149-160`). Aynı blok `buildLayoutB`'nin en üstüne (işletme başlığından önce) eklenir; **aynı kural:** yalnız `groupCount > 1` iken dolu gelir, tek grupta `null` → hiçbir şey basılmaz.
**Gerekçe:** bölünmenin yarattığı belirsizlik sipariş türünden bağımsızdır — fırıncı, paket siparişin diğer yarısının varlığını başka hiçbir yerden göremez; iki fiş yan yana gelirse "çift sipariş" sanılır (Amd1 K16 gerekçesi aynen geçerli). v3 emsali: istasyon etiketi order_type'tan bağımsız basılıyordu. `kitchen-receipt.ts:88,98` JSDoc'lardaki "yalnız Layout A" ifadeleri güncellenir.

**K8 — Tek istasyona düşen paket siparişi: BÖLÜNME boyutunda regresyon YOK, içerik boyutunda bilinçli değişiklik VAR.**
Dürüst muhasebe: tüm kalemleri tek istasyona düşen bir paket siparişinde **job sayısı, `kind` değeri, `groupIndex/groupCount` ve istasyon etiketi bugünküyle birebir aynıdır** (tek `kitchen` job, `1/1`, etiket yok). Ama fişin **içeriği** iki bilinçli kararla değişir: fiyat/TUTAR gider (K3), müşteri bloğu daralır (K14). Ve **yeni bir kâğıt eklenir** (kasa paket fişi, K4). "Hiçbir şey değişmiyor" demek yanlış olur; değişen tam olarak ürün sahibinin talep ettiğidir.

**K9 — `delivery` sipariş türü: ORTAK yolla kapsanır, ayrı dal YAZILMAZ.**
- **Bölünme:** K1 koşulu **kaldırdığı** için `delivery` otomatik kapsanır — ekstra satır yok, ölü kod yok.
- **Yerleşim:** `order_type !== 'dine_in'` → Layout B; zaten böyle.
- **Kasa paket fişi:** tetikleyici `POST /orders` **takeaway** dalındadır. Üretimde `order_type:'delivery'` yazan **hiçbir yer yok** (S100 güvenlik incelemesi + `packages/db/src/repositories/orders.ts:1593` yorumu + prod'da 0 satır) → `delivery` için ayrı bir enqueue dalı **yazılmaz**. Enum'da değer duruyor olması kod yazmayı gerektirmez; v5.1'de gerçek bir delivery akışı gelirse aynı handler genişler.
**Reddedilen:** "her ihtimale karşı `order_type !== 'dine_in'` diye genel bir dal yaz" — reddedildi: çalıştırılmayan, test edilemeyen, doğrulanamayan kod üretir (ölü kod üretme kuralı).

**K10 — İptal fişi (`enqueue-cancel-job.ts`): DEĞİŞİKLİK YOK — zaten doğru.**
**Koda bakıldı, varsayılmadı:** `enqueue-cancel-job.ts:131-135` `resolveItemStations`'ı **koşulsuz** çağırıyor; `order_type` kontrolü **yok**. Amd1 K14 bunu kasten böyle yazdı ("K4b iptal yolunda geçerli değil — iptal fişi tutar/PII basmaz"). Yani paket siparişte iptal fişi **bugün de** istasyona bölünüyor. Bu Amendment'tan sonra iki yol **hizalanır** ve yukarıda tarif edilen canlı tutarsızlık kapanır. Dosya **dokunulmaz**.
**Bilinçli kapsam dışı:** iptal fişinde K16 istasyon etiketi/parça göstergesi **basılmıyor** (`:155-164` — `renderCancelReceipt` çağrısında böyle parametreler yok). Bu Amendment bunu **düzeltmez**: iptal fişi hangi kalemin iptal edildiğini zaten adıyla söyler ve "siparişin diğer yarısı" problemi iptal fişinde yoktur (iptal fişi bütünlük iddia etmez). Tutarlılık borcu olarak `scratchpad`'e chip düşülür.

**K11 — Migration GEREKMEZ. Teyit edildi.**
`categories.print_station` **Migration 048**'de (`048_categories_print_station.sql`) canlı; `orders.delivery_address_snapshot` / `delivery_note` / `planned_payment_type` / `customer_id` ve `customers`/`customer_phones` tabloları zaten var; `print_jobs.payload` JSONB, şeması değişmiyor; `PrintJobKindSchema` genişlemiyor (`bill` yeniden kullanılıyor, K4). **Prod migration head 049** (`049_agents_display_name_declared_kinds.sql`, Amd2). → **`packages/db/` DOKUNULMAZ**; `db-migration-guard` gate'i **tetiklenmez** (ama PR açıklamasında "migration yok" açıkça beyan edilir ve `git diff --stat packages/db` boş çıktısı kanıt olarak eklenir).
**Deploy profili:** yalnız `apps/api` → normal API deploy (`git push prod` + `pm2 restart pos-api`). **Print-agent exe DEĞİŞMEZ, agent config DEĞİŞMEZ, MSI/copy-over YOK, dükkan-PC'ye dokunulmaz.** `shared-types` değişmediği için dist-build riski de yok (yine de deploy.md sırası aynen izlenir).

**K12 — Kapsam kilidi (v5.0'da NE YOK — açık liste).**
1. Teslimde (`delivered`) otomatik kasa fişi (v3 `receipt_takeaway_complete`) → v5.1
2. Kalem-eklemede paket fişi yeniden basımı → v5.1 (manuel "Yazdır" var)
3. Otomatik-basım aç/kapa ayarı (v3'ün yazıcı-başına `autoPrint` anahtarları) → v5.1; v5.0'da davranış **sabit**
4. `dine_in` siparişte oluşturmada otomatik kasa fişi → **YOK** (masa hesabı ödeme anında basılır; değişmez)
5. İptal fişinde istasyon etiketi (K10) → v5.1
6. Ayrı fiziksel "paket etiketi" yazıcısı (v3 `takeawayLabelPrinterId`) → **YOK**, kasa yazıcısı kullanılır
7. Fişte barkod/QR/paket numarası → **YOK**
8. Yeni `PrintJobKind` değeri (`packing`) → **YOK**, `kind='bill'` + `meta.variant='packing'` (K4)
9. İstasyona göre KDS filtreleme → **YOK** (Amd1 K3 aynen geçerli)
10. Paket fişi kopya sayısı ayarı (2 nüsha vb.) → **YOK**

**K13 — Dil ve i18n.**
Fiş metinleri **Türkçe sabitlerdir** ve yerleşik şablon konvansiyonuna uyar (`bill-receipt` / `kitchen-receipt` / `cancel-receipt` üçünde de böyle: `Adisyon No:`, `TUTAR`, `AFİYET OLSUN`). Fiş çıktısı i18n katmanına bağlı değildir — tek tenant, tek dil, sunucuda render (ADR-004 §7). Slug'lar kod-içi İngilizce (`packing`, `bill`), kâğıda basılan her şey Türkçe.
**Bu işte kullanıcıya görünen YENİ UI metni YOKTUR** (yeni buton/ekran/toast yok) → `apps/web/src/i18n/locales/tr.json` **dokunulmaz**. Bu açıkça yazılıyor ki "hardcoded string" ihlali sanılmasın; ihlal, UI'da t() atlamaktır, fiş şablonunda değil.
Fiş başlık önerisi: **`PAKET SİPARİŞ`** (v3'te "PAKET SİPARİŞİ" / "PAKET ETİKETİ" vardı). Kasa yazıcısından çıkan iki belgeyi (adisyon vs. paket) kâğıt üstünde ayırt edilebilir kılmak için başlık **zorunludur**.

**K14 — Mutfak/istasyon fişinde (Layout B) müşteri bloğu DARALTILIR: yalnız MÜŞTERİ ADI kalır.**
`buildLayoutB`'de bugün basılan beş alandan (`Müşteri` / `Telefon` / `Adres` / `Tarif` / `Ödeme` — `kitchen-receipt.ts:223-237`) **yalnız `Müşteri` kalır**; `Telefon`, `Adres`, `Tarif`, `Ödeme` **kaldırılır**. Bu dört alanın tamamı **kasa paket fişinde (K4) yer alır**.
**Gerekçe:** (a) **KVKK veri minimizasyonu** — mutfak telefon/adres/ödeme bilgisini kullanmaz; bölünmeyle bu blok her istasyonda tekrarlanacağı için minimize etmemek KVKK yüzeyini fiziksel olarak N katına çıkarır (K4b'nin ikinci itirazı tam olarak buydu). (b) Müşteri **adı** paketleme sırasında poşetleri ayırt etmenin ve mutfak seslenişinin doğal aracıdır; operasyonel değeri yüksek, riski düşük. (c) Adres/telefon **kuryenin** işidir ve artık kuryeye giden ayrı bir kâğıt var (K4) — bilgi kaybolmuyor, **doğru kâğıda taşınıyor**.
**K14, K4'e BAĞLIDIR — ZORUNLU SIRALAMA.** Bugün adres yalnız mutfak fişinde basılıyor ve kurye slip'i görevini o görüyor. K4 gönderilmeden K14 uygulanırsa **adres hiçbir kâğıtta kalmaz** ve kurye teslimat yapamaz. **İkisi aynı sürümde gider; K4 ertelenirse K14 de ertelenir** (mutfak fişi bugünkü tam bloğunu korur). Bu bağ DoD'de gate olarak yer alır.
**Reddedilen:** (i) "mutfak fişinde hiç müşteri bilgisi olmasın, yalnız adisyon no" — reddedildi, paketleyici için ad pratik bir eşleştirme anahtarı; ürün sahibi isterse tek satır silmekle olur (açık madde 3). (ii) "bugünkü tam blok kalsın" — reddedildi, minimizasyon ilkesine aykırı ve bölünmeyle çoğalıyor.

**K15 — Non-functional beklentiler.**
Paket siparişi oluşturma yolu bugün 1 enqueue yapıyor, sonrasında en fazla 3 yapacak (2 istasyon + 1 kasa). Enqueue'lar **tx dışında, sıralı** ve her biri birkaç lean SELECT + 1 INSERT. Beklenen ek gecikme p95'te **< 150 ms** (raster render dahil; Amd9 ölçümleri masa fişinde bu bandı gösteriyor). `POST /orders` (takeaway) p95 hedefi **≤ 800 ms** olarak korunur. Aşılırsa çözüm enqueue'ları paralelleştirmek DEĞİL, **yanıtı bloklamamaktır** (fire-and-forget); bu v5.1 optimizasyonu olarak not edilir, şimdi yapılmaz (sessiz hata yüzeyi açar).

---

### Sonuçlar

- (+) Izgaracı paket siparişlerini **görebilir** — bugün göremiyor ve ızgarada KDS de yok; bu bir üretim-boşluğunun kapanmasıdır.
- (+) Sipariş fişi ile iptal fişi **aynı yönlendirme kuralına** oturur; bugünkü canlı tutarsızlık (sipariş FIRIN'dan, iptali IZGARA'dan) kapanır.
- (+) Kurye/paketleme kâğıdı **doğru yazıcıdan** (kasa) çıkar; bugün mutfak yazıcısından çıkıyor.
- (+) Mutfak kâğıdında para bilgisi dolaşmaz; v3 paritesine dönülür.
- (+) KVKK yüzeyi **net olarak daralır**: telefon/adres/ödeme N adet mutfak fişinden 1 adet kasa fişine iner (K14+K4 birlikte).
- (+) **Migration yok, exe yok, agent config yok, dükkan-PC teması yok** → geri alma tek `git revert` + `pm2 restart`, dakikalar.
- (+) Kod sadeleşir: bir koşul, iki tip alanı, iki SELECT kolonu ve bir import **eksilir**.
- (−) **Kâğıt tüketimi artar**: iki istasyonlu bir paket siparişi bugün 1 fiş basıyor, sonra 3 basacak (FIRIN + IZGARA + KASA). Kabul edilen takas.
- (−) `dine_in` siparişlerde kasa fişi hâlâ oluşturmada basılmaz (bilinçli, K12/4) → paket ile masa akışı bu noktada asimetrik kalır; asimetri operasyonel olarak doğrudur ama açıklanması gerekir.
- (−) Kalem eklendiğinde paket fişi güncellenmez (K5) → paketleyicinin elindeki kâğıt eksik kalabilir; hafifletici: mutfak fişi basılır + manuel "Yazdır" var. **Ürün sahibine sorulacak (açık madde 2).**
- (−) `kind='bill'` iki farklı belgeyi taşır (adisyon + paket fişi) → `payload->>'kind'` ile sayım artık iki türü karıştırır; ayrım `meta.variant` ile yapılır. Doğrulama sorguları buna göre yazılır.
- (−) K3 ile `kitchen-receipt` testlerinin tutar assert'leri kırılır → güncellenmeleri gerekir (DoD).

### Riskler

- **R1 — Kasa yazıcısı Adisyo ile paylaşımlı (KASA-2026).** Cutover öncesi smoke fişleri Adisyo'nun kuyruğunu bozmaz (spooler ayrı queue) ama **personel karışıklığı** yaratabilir. Azaltma: smoke **kapanış sonrası**, kalem notunda "TEST — HAZIRLAMA YOK", test siparişleri `docs/ops/cutover-test-temizligi.md` ile silinir.
- **R2 — K14 ile K4 ayrılırsa adres kaybolur.** Kurye teslim edemez. Azaltma: K14 gate'i DoD'de zorunlu (K4 merge edilmeden K14 merge edilemez).
- **R3 — Kasa yazıcısı fişi basmazsa paketleme bilgisiz kalır.** Bugün bu bilgi mutfak fişinde vardı (yedek). K14 sonrası tek kaynak kasa fişidir. Azaltma: `print_jobs` retry mekanizması mevcut (ADR-004 Amd6 Part B ack dayanıklılığı); ayrıca `failed` job'lar için mevcut izleme sorgusu smoke'ta çalıştırılır.
- **R4 — Paket siparişte üç ayrı kâğıt akışı** → mutfak personeli hangi kâğıdın kimin olduğunu ilk günlerde karıştırabilir. Azaltma: K7 istasyon etiketi + parça göstergesi + K13 `PAKET SİPARİŞ` başlığı; cutover eğitiminde tek slaytla anlatılır.
- **R5 — Cutover penceresine 3 gün var.** Bkz. Kapsam kilidi/dilimleme.
- **R6 — Doğrulanamayan varsayım:** ızgara istasyonunun paket siparişlerdeki gerçek iş hacmi ve mutfağın müşteri adını fiilen kullanıp kullanmadığı **kodda görünmez**; K14'ün "ad kalsın" tercihi ürün sahibi teyidine tabidir (açık madde 3).

### Kapsam kilidi ve cutover değerlendirmesi (dilimleme)

**Dilim A — CUTOVER BLOKERİ. K1 + K3 + K7.**
Tek dosyada bir koşul silme + tek şablonda fiyat kaldırma + K16 bloğunu Layout B'ye kopyalama. Küçük, cerrahi, geri alması tek revert. **Blokerdir** çünkü: ADR-032 Amd1 atamaları prod'da **canlı** ve bu haliyle paket siparişlerde ızgara kalemleri **hiçbir kâğıtta ve hiçbir ekranda görünmüyor** (ızgarada KDS yok). Cutover'da Adisyo bırakıldığında bu, kaybolan sipariş demektir. Alternatif geri-dönüş (Amd1 K11 fallback: tüm `print_station = NULL`) bu boşluğu kapatır **ama masa bölünmesini de öldürür** — yani ürün sahibinin bugün doğruladığı kazanımı geri verir. Doğru çözüm Dilim A'dır.

**Dilim B — CUTOVER BLOKERİ DEĞİL (ama yüksek değerli). K4 + K5 + K6 + K13 + K14.**
Yeni şablon + yeni enqueue + tek çağrı + PII taşıma. Bugün kasa fişi **hiç yok** ve kurye slip'i görevini mutfak fişi görüyor — yani operasyon **kâğıtsız kalmıyor**, yalnız yanlış yazıcıdan çıkıyor. Cutover'a yetişirse gitmeli; yetişmezse **stabilizasyon penceresinde** (27 Tem+) gider. **Yetişmezse K14 de ertelenir** (mutfak fişi tam PII bloğunu korur) — bu bağ mutlaktır.

**Dilimlerin bağımsızlığı kod düzeyinde doğrulanmıştır:** Dilim A yalnız `enqueue-kitchen-job.ts` + `kitchen-receipt.ts`'e; Dilim B yalnız yeni iki dosya + `orders.ts`'e tek satıra dokunur. Tek ortak dosya `kitchen-receipt.ts`'tir ve orada Dilim A fiyat/K16, Dilim B (K14) müşteri bloğu ile ilgilenir — çakışma yok, sıra serbest.

**Kapsam büyümesi kontrolü:** üç talebin üçü de v3'te vardı (bölünme ✓, mutfakta fiyatsızlık ✓, paket için ayrı kâğıt ✓) → v5'in "v3 kapsamını koru" kilidine uygundur; yeni özellik değil, **kapatılmamış v3 paritesidir**. K12'deki 10 madde bilinçli olarak dışarıda bırakılmıştır.

### Definition of Done

**Kod**
- [ ] `enqueue-kitchen-job.ts`: `order.order_type === 'dine_in' ? ... : ...` koşulu **kaldırıldı**; `resolveItemStations` koşulsuz çağrılıyor (K1). `:186-192` yorum bloğu K4b gerekçesinden arındırıldı, Amd3 K1'e referans verildi.
- [ ] `enqueue-kitchen-job.ts`: SELECT'lerden `order_items.total_cents` ve `orders.total_cents` düştü (K3). `orders` SELECT'inden **`delivery_address_snapshot` / `delivery_note` / `planned_payment_type` de düştü** (K14 ile artık okunmuyorlar — ölü fetch bırakma).
- [ ] `kitchen-receipt.ts`: `KitchenReceiptItem.lineTotalCents` ve `KitchenReceiptParams.total_cents` **kaldırıldı**; Layout B kalem satırı `leftRight(ad, qtyLabel)`; `TUTAR` satırı silindi; `moneyDigits` import'u kaldırıldı (K3).
- [ ] `kitchen-receipt.ts`: `delivery_address` / `delivery_note` / `planned_payment_type` parametreleri **kaldırıldı**; `customer_name` kaldı, `customer_phone` **kaldırıldı** (K14). `PAYMENT_TYPE_LABELS` import'u ölürse kaldırıldı.
- [ ] **`moneyDigits` ve `ReceiptCanvas.itemRow` KALDI** — `bill-receipt.ts:131,158` tüketiyor (kod-teyitli); önceden var olan kod, sorulmadan silinmez.
- [ ] `kitchen-receipt.ts`: K16 bloğu `buildLayoutB`'ye eklendi; `:88,98` JSDoc'lardaki "yalnız Layout A" ifadeleri düzeltildi; dosya başı yorumundaki "Layout B ... FİYAT VAR" ifadesi güncellendi (K7).
- [ ] **YENİ** `templates/packing-receipt.ts` — saf render (`params → Uint8Array`), IO yok, raster (Amd9) + buzzer (Amd8) + kasa kuyruk davranışı; başlık `PAKET SİPARİŞ` (K4/K13).
- [ ] **YENİ** `enqueue-packing-job.ts` — tek-fetch otoritesi; `kind:'bill'`, `meta.variant:'packing'`, **meta'da PII YOK** (K4/K6).
- [ ] `orders.ts` takeaway POST: **tek satır** çağrı, mutfak bloğundan sonra, `kitchenItems` guard'ının **dışında**, `try/catch`+logger ile best-effort (K5).
- [ ] `packages/db/` · `packages/shared-types/` · `apps/print-agent/` · `apps/web/` · `apps/mobile/` · `enqueue-cancel-job.ts` · `enqueue-bill-job.ts` · `resolve-item-stations.ts` **DOKUNULMADI** — kanıt: PR'da `git diff --stat` çıktısı.
- [ ] `any` yok, TS strict temiz, ESLint temiz, orphan import yok.

**Test**
- [ ] Regresyon: `dine_in` + tek istasyon → **1 job**, `kind='kitchen'`, `groupIndex 1/1`, `station_label` yok.
- [ ] Regresyon: `dine_in` + iki istasyon → 2 job, etiket + `Fiş 1/2` (mevcut test korunur).
- [ ] **YENİ**: `takeaway` + iki istasyonlu kalemler → **2 mutfak job** (`kitchen` + `grill`), her birinde `station_label` + `part_label`, ikisi de Layout B.
- [ ] **YENİ**: `takeaway` + tek istasyon → 1 mutfak job, etiket YOK (K8).
- [ ] **YENİ**: `takeaway` oluşturma → `print_jobs`'ta **`kind='bill'` + `meta.variant='packing'`** tam 1 satır.
- [ ] **YENİ**: `takeaway` + yalnız `kitchen_print=false` kalemler (içecek) → **0 mutfak job + 1 packing job** (K5 guard-dışı kanıtı).
- [ ] **YENİ**: mutfak fişi byte'larında tutar/₺ **YOK**; packing fişinde **VAR** (K3 negatif assert).
- [ ] **YENİ**: mutfak fişinde telefon/adres **YOK**; packing fişinde **VAR** (K14 negatif assert).
- [ ] `packing-receipt` unit: raster zarfı (`ESC @` ilk 2 bayt · `GS v 0` alt-dizisi · buzzer 8-12) — `bill-receipt.test.ts` emsali.
- [ ] Enqueue hatası → sipariş oluşturma **201 dönüyor** (best-effort kanıtı, K5).
- [ ] `enqueue-cancel-job` testleri **değişmeden geçiyor** (K10 — dokunulmadığının kanıtı).

**Gate'ler**
- [ ] `security-reviewer` **ZORUNLU** — PII yüzeyi değişiyor (K4 kasa fişine PII girer, K14 mutfak fişinden PII çıkar). Net yüzey daralıyor, ama **kasa yazıcısında PII ilk kez** basılacak → KVKK aydınlatma metni ve fiş-kâğıdı imha pratiği `docs/` KVKK envanteriyle çapraz kontrol edilir.
- [ ] `db-migration-guard` **GEREKMEZ** — migration yok (K11); PR açıklamasında açıkça beyan + `git diff --stat packages/db` boş kanıtı.
- [ ] `hci-reviewer` / `turkish-ux-reviewer` — **UI değişikliği yok**, ama fiş kâğıdı çıktısı kullanıcıya görünen yüzeydir → kâğıt-smoke fotoğrafı üzerinden Türkçe/hizalama/okunabilirlik gözden geçirilir.
- [ ] **K14 GATE:** K4 aynı sürümde değilse K14 **uygulanmaz** (adres hiçbir kâğıtta kalmaz — R2).
- [ ] **K3 GATE:** K1, K3 olmadan merge edilemez (tutar çelişkisi — K1 gerekçesi).

**Fiziksel DoD [USER] — kapanış sonrası**
- [ ] İki istasyonlu paket siparişi → **üç kâğıt**: FIRIN (fiyatsız, `FIRIN Fiş 1/2`, müşteri adı var, telefon/adres YOK) + IZGARA (aynı, `2/2`) + KASA (`PAKET SİPARİŞ`, müşteri/telefon/adres/ödeme + tutarlar + TUTAR).
- [ ] Çapraz-kontaminasyon YOK; Türkçe (İ/ş/ı/ğ/ç/ö/ü) + ₺ temiz; her job `success` / `attempts=0`.
- [ ] Tek istasyonlu paket siparişi → **iki kâğıt** (1 mutfak + 1 kasa), mutfak fişinde etiket YOK.
- [ ] Masa siparişi → bugünküyle **birebir aynı** (regresyon kontrolü).
- [ ] Paket siparişte kalem iptali → yalnız ilgili istasyondan çıkıyor (K10 doğrulaması).

**Belgeleme**
- [ ] ADR `decisions.md`'ye işlendi; **Amd1 K4b'nin üstüne "SUPERSEDED by Amd3 K1"** notu düşüldü; **ADR-004 Amd5 K4/K7'ye "kısmen superseded"** çapraz-referansı eklendi.
- [ ] `docs/ops/` runbook: paket siparişte beklenen kâğıt sayısı + doğrulama SQL'i (`meta.variant` ile bill/packing ayrımı).
- [ ] `scratchpad.md`: iptal fişinde istasyon etiketi eksiği (K10) chip olarak düşüldü.

---

<!-- ADR-032 Amendment 3 PROPOSED (2026-07-21) — PAKET SİPARİŞ FİŞ AKIŞI. Tetik: Amd1 masa-bölünmesi prod'da doğrulandı, ürün sahibi paket siparişte 3 şikayet: (1) kasadan fiş çıkmadı (2) kategori→yazıcı ataması paket'te çalışmıyor (3) ızgara ürünü FIRIN'dan çıktı IZGARA'dan hiç çıkmadı. DB kanıt: tek kind=kitchen job groupIndex 1/1 itemCount=3. KÖK-NEDEN(2+3) enqueue-kitchen-job.ts:201-205 order_type==='dine_in' koşulu = Amd1-K4b bilinçli kararı (gerekçe: LayoutB sipariş-seviyesi total_cents+PII bölünürse tutar-çelişir + PII-çoğalır); iki varsayımı da bugün yanlışlandı. KÖK-NEDEN(1) enqueueBillJob yalnız print-bill(orders.ts:786)+ödeme(payments.ts:209); takeaway ödemesi takeaway-stage delivered tx-içi→orada da YOK → paket'te kasa fişi HİÇ yapılmamış. GİZLİ CANLI TUTARSIZLIK (bu incelemede bulundu): enqueue-cancel-job.ts:131 resolveItemStations KOŞULSUZ → paket'te sipariş-fişi FIRIN'dan ama İPTAL-fişi IZGARA'dan; ızgaracı görmediği ürünün iptalini alıyor, fırıncı iptali görmüyor. Ağırlaştırıcı: ızgarada KDS YOK yalnız kağıt. V3-REF(READ-ONLY, kendi cümlelerimle): (a) printJobs.js:161-215 byPrinter gruplama order_type-AYRIMI-YOK → paket v3'te de bölünüyordu, K4b v3'e göre GERİLEME; (b) renderers.js:710-732 mutfak fişi ÜRÜN/ADET-only FİYAT-YOK → fiyat v5-sapması; (c) renderers.js:704 istasyon-etiketi order_type-bağımsız basılıyordu; (d) printerAutoPrintPolicy.js:11-36 kitchen_takeaway_order_create + receipt_takeaway_complete + AYRI 'PAKET ETİKETİ' render-türü (printJobs.js:550-600, takeawayLabelPrinterId, kitchen-rol yazıcı) → "üretim-emri vs paketleme-kağıdı AYRI şablon" emsali; v3 kasa fişini TESLİMDE basıyordu oluşturmada değil. KARARLAR K1-K15: K1 bölünme TÜM türlere (dine_in koşulu SİLİNİR, cancel-job'un aynısı); K3 ÖN-KOŞUL, K1'i K3'süz merge YASAK. K2 Layout A/B seçimi DEĞİŞMEZ (bölünme⊥yerleşim; Amd1 hatası ikisini tek koşulda birleştirmesi). K3 LayoutB'den fiyat+TUTAR KALKAR (kitchen-receipt.ts:242,251); LayoutA zaten fiyatsız(:186-189)→"masa farketmeksizin" no-op; ölü-param lineTotalCents+total_cents KALDIRILIR + enqueue SELECT'ten total_cents düşer + moneyDigits-import ölür; AMA moneyDigits/itemRow helper'ları KALIR (bill-receipt.ts:131,158 tüketiyor). K4 YENİ packing-receipt.ts şablonu, kind='bill' + meta.variant='packing' (YENİ ENUM DEĞERİ YOK→exe/config/agent DOKUNULMAZ); içerik=LayoutB'nin fiyatlı+tam-PII hali + 'PAKET SİPARİŞ' başlığı. REDDEDİLEN: (B) enqueueBillJob'u çağır→adisyon fişi bilinçli PII-safe (enqueue-bill-job.ts:14, payments.ts:205) + ödeme-dökümü/Kalan satırı sipariş-anında anlamsız; (C) LayoutB'ye show_prices bayrağı→K3'ün yapısal güvencesini boolean'a indirger, ters-geçilirse mutfağa fiyat gider ve fark edilmez, dosya-adı yanıltıcı, test-matrisi 2x; (D) ayrı fiziksel paket-etiketi yazıcısı→4. yazıcı+agent, ürün sahibi kasadan istedi. K5 tetikleyici YALNIZ takeaway-POST-oluşturma; kitchenItems-guard'ın DIŞINDA koşulsuz (yalnız-içecek siparişi de paketlenir); best-effort try/catch→201 bozulmaz; kalem-eklemede YENİDEN BASILMAZ (iki kağıt karışır+israf; manuel Yazdır var) ama mutfak fişi basılmaya devam; delivered'da BASILMAZ (v3'te vardı→v5.1, sessiz kapsam büyümesi yasak). K6 tek-fetch otoritesi enqueuePackingJob(orderId,tenantId,actorUserId); meta PII-SAFE (ADR-024). K7 K16 istasyon-etiketi+parça-göstergesi LayoutB'ye de (groupCount>1 kuralı aynı; tek grupta null); v3-paritesi. K8 DÜRÜST: tek-istasyon paket'te BÖLÜNME-boyutunda regresyon YOK ama içerik değişir (K3 fiyat gider, K14 blok daralır) + yeni kağıt (K4). K9 delivery: bölünme koşul-SİLİNDİĞİ için otomatik kapsanır; kasa-fişi tetikleyicisi takeaway-dalında, üretimde order_type:'delivery' YAZAN YER YOK (S100+repositories/orders.ts:1593+prod 0 satır)→AYRI DAL YAZILMAZ (ölü kod üretme). K10 enqueue-cancel-job DEĞİŞİKLİK YOK—KODA BAKILDI:131-135 koşulsuz, dine_in kısıtı YOK, Amd1-K14 kasten böyle; Amd3 sonrası iki yol HİZALANIR. Bilinçli kapsam-dışı: iptal fişinde K16 etiketi yok (:155-164)→chip. K11 MİGRATION GEREKMEZ-TEYİT: print_station Migration 048'de canlı, head 049 (agents_display_name_declared_kinds/Amd2), payload şeması+enum değişmez → packages/db DOKUNULMAZ, db-migration-guard tetiklenmez, deploy=normal API (pm2), exe/agent/dükkan-PC TEMASSIZ. K12 kapsam-kilidi 10 madde YOK: delivered-kasa-fişi · kalem-eklemede-reprint · autoPrint-aç/kapa-ayarı · dine_in-oluşturmada-kasa-fişi · iptal-fişinde-istasyon-etiketi · ayrı-paket-etiketi-yazıcısı · barkod/QR · yeni-kind-değeri · istasyona-göre-KDS · kopya-sayısı. K13 fiş metinleri Türkçe-sabit (3-şablon konvansiyonu, fiş i18n'e bağlı değil); YENİ UI METNİ YOK→tr.json DOKUNULMAZ (ihlal UI'da t() atlamaktır, şablonda değil). K14 LayoutB müşteri bloğu DARALIR: yalnız 'Müşteri' adı KALIR, Telefon/Adres/Tarif/Ödeme KALKAR (:223-237)→hepsi kasa paket fişinde; gerekçe KVKK-minimizasyon (bölünmeyle N× çoğalacaktı=K4b'nin 2. itirazı) + ad paketlemede eşleştirme-anahtarı + adres/telefon KURYENİN işi. K14 K4'E BAĞLI-ZORUNLU-SIRALAMA: K4'süz K14 → adres HİÇBİR kağıtta kalmaz, kurye teslim edemez → K4 ertelenirse K14 de ertelenir (DoD gate). K15 NFR: enqueue 1→3, ek gecikme p95<150ms, POST /orders(takeaway) p95≤800ms; aşılırsa çözüm paralelleştirme DEĞİL fire-and-forget (v5.1). NUMARALANDIRMA: ADR-032 Amd3 çünkü konu YÖNLENDİRME + ağırlık merkezi K4b'nin doğrudan revizyonu + yeni endpoint/migration/payload/agent-kontratı YOK (Amd5/6/7 kriteri); karşı-argüman kayda geçti (K3/K14 içerik=ADR-004-Amd5 alanı, K4 yeni şablon=ADR-004 §7) → bölmemeyi öneriyorum çünkü K3, K1'in ÖN KOŞULU, ayrı belgelerde bağ görünmez olur. DİLİMLEME: DİLİM-A=K1+K3+K7 CUTOVER BLOKERİ (paket'te ızgara kalemleri hiçbir kağıt+hiçbir ekranda görünmüyor, ızgarada KDS yok, cutover'da kaybolan sipariş; Amd1-K11 fallback tüm-NULL bu boşluğu kapatır AMA masa bölünmesini de öldürür→yanlış çözüm); DİLİM-B=K4+K5+K6+K13+K14 BLOKER DEĞİL (bugün kurye slip'i görevini mutfak fişi görüyor, kağıtsız kalmıyor yalnız yanlış yazıcıdan)→yetişmezse stabilizasyon 27-Tem+, K14 de ertelenir. Dilimler kod-düzeyinde bağımsız (tek ortak dosya kitchen-receipt.ts, çakışmayan bölümler). Kapsam-kilidi: üç talebin ÜÇÜ DE v3'te vardı→yeni özellik değil KAPATILMAMIŞ V3 PARİTESİ. GATE'ler: security-reviewer ZORUNLU (kasa yazıcısında PII İLK KEZ; net yüzey daralıyor ama KVKK aydınlatma+fiş-imha çapraz kontrol), db-migration-guard GEREKMEZ, hci/turkish-ux kağıt-smoke. AÇIK MADDELER[USER]: (1) kasa paket fişinde fiyat/TUTAR olsun mu [öneri EVET] (2) kalem eklenince paket fişi yeniden bassın mı [öneri HAYIR] (3) mutfak fişinde müşteri ADI kalsın mı [öneri EVET, telefon/adres KALKSIN] (4) Dilim-B cutover'a mı stabilizasyona mı (5) fiş başlığı 'PAKET SİPARİŞ' onayı. -->
