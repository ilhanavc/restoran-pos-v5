# Scratchpad

Oturumlar arası geçici notlar. Kalıcı karar varsa ADR olarak `decisions.md`'ye taşı. Bitmiş görev varsa `active-plan.md`'de ✅ işaretle.

## Açık sorular

<!-- Çözüm bekleyen teknik/ürün soruları -->

- [ ] Proje adı kesinleşsin mi? (şimdilik `restoran-pos-v5`)
- [ ] İlk pilot restoran (kendi restoranım) için hangi özellik set'i MVP'de olmalı? v3 referans alınacak ama kapsam küçültülecek
- [ ] Print Agent Windows Service mi olacak, yoksa sistem tray'inde çalışan basit bir uygulama mı?

## Yapılacaklar notları

<!-- Atlanmaması gereken küçük şeyler -->

- v3 repo'sunu okuma-sadece mount et, copy-paste riskini azalt
- v3'ten değerli parçaların listesi: hangisi mimari referans, hangisi davranış referansı, hangisi test senaryosu
- Hetzner hesap kurulumu Phase 1'e girmeden yapılmalı

## ADR-002 açık kararlar

<!-- ADR-002 (Auth stratejisi) yazılırken bu kararlar şartname olarak taşınacak -->

- **Şifre sıfırlama stratejisi (hibrit):**
  - v5.0 MVP: admin reset (Ayarlar → Kullanıcı Yönetimi'nden elle)
  - v5.0 backend: email token endpoint yazılır ama UI'da gösterilmez (ready-but-disabled)
  - v5.1: feature flag ile aktif edilir

## v3 bulguları — mimari sinyaller

<!-- v3 reference röportajları sırasında çıkan, v5 mimari kararlarını etkileyecek sinyaller -->

1. **Garson rol kapsamı v3'te daraltılmış** — yalnız `/tables` route. Sipariş yönetimi masa detayı içinde entegre, ayrı `/orders` route yok. **How to apply:** v5 Modül 4 (Masa) tasarımında dikkat edilecek, garson UX masa ekranı merkezli akacak.

2. **Rol matrisi v3'te tek merkezi yerde** (`tD` nav array). Config-driven yaklaşım, her component'te tekrar etmez. **How to apply:** v5'te korunacak — ADR-002 kuralı: "role → routes mapping tek bir config dosyasında, frontend nav + backend guard aynı kaynaktan okur."

3. **Backend route guard belirsiz** — v3'te frontend navigation filter kesin (`tD` nav array) ama backend `requireRole` middleware varlığı doğrulanamadı. Potansiyel güvenlik açığı — `pain-points.md`'ye gidecek madde. **How to apply:** v5'te kesinleşecek — backend her endpoint'te rol kontrolü zorunlu.

4. **Şifre sıfırlama** — admin-manuel-reset modeli v3 kodunda mevcut (`POST /auth/forgot-password`) ama UI/endpoint kesişimi bozuk. Hibrit ADR-002 önerimizle uyumlu. **How to apply:** v5'te yeniden tasarım değil, mevcut intent'i düzgün çalıştırma.

5. **Özellik grubu atama — ikili model altyapıda hazır** (`attributes.js:135-138`). v3 DB'sinde hem `category_attribute_groups` hem `product_attribute_groups` tablosu mevcut ama UI sadece ürün atamasını gösteriyor. Kullanıcı kategoriye atamayı açıkça tercih ediyor. **How to apply:** v5 Modül 3 (Menü) MVP'sinde kategori atama UI'ya çıkarılacak; ürün override korunur.

6. **Snapshot semantiği kritik** — v3'te `order_items.product_name` sipariş anında snapshot'lanıyor, raporlar `GROUP BY oi.product_name` ile bu snapshot üzerinden çalışıyor (`reports.js:61,65`). Menü güncellemesi eski siparişleri etkilemiyor. **How to apply:** v5 shared-domain'de Order entity'si snapshot pattern'ı korumalı — sipariş kalemi menü ID'sine değil, fiyat+ad+varyant snapshot'ına bağlı.

7. **Hibrit silme pattern** (`products.js:432-476`) — sipariş geçmişi varsa soft-delete, yoksa hard-delete + görsel dosyası temizliği. **How to apply:** v5 DB ADR-003'te "silinebilir vs. referans tutulan entity'ler" için şablon olarak kullanılacak.

8. **Yazıcı yönlendirme çift mekanizma — sadeleştir** (`printRouting.js:50-57`): v3'te önce `printer_routing` tablosu (kategori bazlı), sonra ürün `printer_target` fallback. UI'da iki mekanizma kafa karıştırıyor, kullanıcı ürün alanının ne işe yaradığını bilmiyor. **How to apply:** v5 MVP'de tek mekanizma = kategori routing. Ürün bazlı override UI v5.1'e.

9. **Garson atama modeli v3'te yok** (Kullanıcı teyit Modül 4): Masa kartındaki garson = aktif siparişi ilk oluşturan, masa garsona kilitli değil. **How to apply:** v5 mobil garson uygulaması geldiğinde bu model yetersiz. v5 MVP'de "masa sorumlu garson" alanı eklenir (değiştirilebilir), admin elle atama/serbest yapar. Data model: `orders.assigned_waiter_id` veya `tables.active_waiter_id` — ADR gerektirir.

10. **Masa birleştirme v3'te yok — MVP'ye alındı** (25 masalı pide/lokanta gerçekliği). v5'te 2+ masa tek adisyon altında birleştirilebilir, sonradan ayrılabilir. **How to apply:** `orders.table_ids[]` (array) yerine `order_tables` junction tablosu. ADR-XXX gerektirir (Phase 1 başında).

11. **"Tek masa = tek aktif sipariş" kuralı** v3'te örtük, v5'te açık invariant olacak. **How to apply:** shared-domain Order entity'sinde invariant; DB'de partial unique index (`WHERE status='open'`). Ek sipariş = aynı adisyona yeni kalem, yeni sipariş değil.

12. **order_type enum = dine_in | takeaway** (`orders.js:53`). Paket servis ayrı akış, masaya bağlanmaz. **How to apply:** v5'te aynı kalır. `takeaway_out_at`, `takeaway_delivered_at` gibi alanlar paket yaşam döngüsü için korunur.

13. **Hedef masa sayısı mekaniği güzel** (`admin.js:2239,2243`): Boş masa düşürme soft-delete, dolu engelleme. **How to apply:** v5'te aynı pattern korunur — runtime "güvenli boyutlandırma" UX'i iyi.

14. **Telefon normalize + unique constraint eksik** (`customers.js:6`, `normalized_phone` var ama unique yok): v3'te aynı telefonla iki müşteri açılabiliyor → Caller ID eşleşmesi belirsizleşiyor. **How to apply:** ADR-003'te `customer_phones.normalized_phone` için `UNIQUE(tenant_id, normalized_phone)` partial index zorunlu.

15. **Müşteri silme yok → anonimize modeli** (kullanıcı kararı): Silme endpoint/UI v5'te olmayacak. KVKK talebi: `full_name='Anonim'`, telefon+adres silinir, `customer_id` + siparişler + `customer_name_snapshot` dokunulmaz. **How to apply:** shared-domain'de `anonymizeCustomer()` fonksiyonu; DB'de veri silme değil üzerine yazma.

16. **Sipariş geçmişi müşteri detayında — kapsam terfi** (charter v5.1 → MVP): Kullanıcı kritik buldu. **How to apply:** `GET /customers/:id/orders` endpoint Phase 2'de planlanacak; müşteri detay sayfasında son N sipariş listesi (tarih, tutar, durum). Yeni ADR gerekli.

17. **Excel import/export — kapsam terfi** (charter v5.1 → MVP): Pilot geçişinde mevcut müşteri tabanını taşımak için kritik. **How to apply:** Phase 2/3 endpoint planına dahil et (`/customers/import` + `/customers/export`). Yeni ADR gerekli.

18. **Print Agent = yazıcı + Caller ID forwarder — tek servis** (kullanıcı kararı): Ayrı Caller ID Bridge servisi yok; restoran PC'sindeki Print Agent her iki sorumluluğu taşır. **How to apply:** ADR-004 Print Agent kapsamına Caller ID forward modülü dahil edilecek. `apps/print-agent` tek Windows servisi.

19. **Caller ID popup polling → Socket.IO emit** (v3 eksikliği düzeltmesi): v3'te `GET /recent` polling (2-3 sn gecikme). v5'te `processIncomingCall()` sonrası `emitToRoom(businessId, 'caller-id', payload)`. **How to apply:** `socket.js`'deki `emitToRoom` fonksiyonu Caller ID için de kullanılır — ayrı socket altyapısı gerekmez.

20. **call_logs 30 gün retention + cron** (kullanıcı kararı): 30 günden eski Caller ID kayıtları otomatik temizlenir. **How to apply:** ADR-003 DB ilkelerine "TTL tabloları ve cleanup cron listesi" bölümü eklenecek. Legacy `incoming_calls` tablosu v5'te kaldırılır.

21. **v3 para birimi çift saklama (float + cents)** (`orderService.js:308-321`): `grand_total` (float) ve `grand_total_cents` (int) aynı anda yazılıyor — charter kuralı "float yasak"la çelişiyor. **How to apply:** v5 shared-domain'de tüm para yalnız `*_cents` integer (minor unit/kuruş). ADR-003'te para birimi tipi net yazılacak.

22. **Kitchen adjustment job pattern** (`orderService.js:799`): Kalem iptali/miktar azaltması mutfağa "kitchen adjustment" print job'ı gönderiyor — aşçı doğru işi iptal edebilsin. **How to apply:** v5 Print Agent protokolünde `job_type='adjustment'` korunur; `{ type: 'cancel' | 'reduce', beforeSnap, afterSnap }` payload.

23. **order_no günlük sıfırlama service katmanında** (`helpers.js:30-37`): DB sequence değil, `store_date(created_at)` üzerinden `MAX(order_no)+1` sorgusu. **How to apply:** v5'te korunur; ADR-003'te "günlük reset id'ler için transactional MAX+1 pattern" notu. Race condition için SELECT…FOR UPDATE veya SERIAL değil explicit lock gerekebilir.

24. **Mutfakta cihaz yok, fiş ana araç** (Kullanıcı teyit Modül 8): v3'te `KitchenScreen.jsx` kodu mevcut ve çalışıyor (aging, bip, kalem işaretleme) ama mutfakta ekran/tablet yok — hiç kullanılmadı. Ana mutfak akışı Print Agent + Modül 9 yazıcı üzerinden kağıt fiş. **How to apply:** v5 MVP'de mutfak ekranı kod paritesi korunur (charter MVP'de yazılı) ama operasyonel zorunluluk değil. Cihaz eşleştirme UI, istasyon filtresi, aging eşik ayarı v5.1'e. Print Agent + Modül 9 doğru yapılırsa %95 işi çözer — mutfak ekranı yatırımı minimal tutulur.

25. **Mutfak ekranında fiyat görünmez — rol prensibi** (v5 kararı): Mutfak rolü mali bilgi görmez. Kart içeriği yalnız operasyonel (ürün, adet, varyasyon, not, bekleme süresi, garson, masa/paket). v3'te fiyat gösterimi doğrulanmadı; v5'te kesin olarak gizlenir. **How to apply:** KDS kart component'i `Money` alanlarını render etmez; shared-ui KDS view preset'i fiyat olmadan.

26. **Print job 20 sn timeout → kasa toast + ses uyarısı** (v5 kararı, Modül 9): Arka planda 2 auto retry (5 sn + 15 sn); 20 sn içinde `printed` olmazsa kasa ekranına toast + sesli uyarı, job başarısız listesine düşer + manuel retry. v3'te retry endpoint var ama timeout-based kasa uyarısı yoktu. **How to apply:** ADR-004 Print Agent sözleşmesine timeout + notification kontratı eklenecek; `printerStatus` ws event kasa UI'da toast tetikler.

27. **Yazıcı sayısı runtime değişken** (Kullanıcı teyit Modül 9): Bugün 1 USB + 2 Ethernet, yarın farklı olabilir. Hardcode yazıcı sayısı yasak. **How to apply:** `printers` tablosu admin CRUD UI (Ayarlar → Yazıcılar), routing data-driven, `printer_routing` UNIQUE(business_id, category_id) ile yönetilir. Zero-config keşif wizard (USB spooler listele + LAN ping tarama) ilk kurulumda.

28. **CP857 kök neden büyük ihtimalle `ESC t 13` eksikliği** (Kodda tespit + Doğrulanmamış, Modül 9): v3 `encodePC857` fonksiyonu doğru ve testi geçiyor (tüm Türkçe byte mapping'leri test dosyasında) ama fişte bozuk çıkıyor → yazıcıya CP857 codepage select komutu (`ESC t 13`) gönderilmiyor, yazıcı PC437 default'unda kalıyor. **How to apply:** v5 Print Agent her baskı öncesi zorunlu preamble `ESC @ + ESC t 13`, UTF-8 → CP857 encoder tek katman, bypass yasak. v3 byte tablosu domain referansı (kod kopyalama değil, tablo). Phase 1 başında `renderers.js` analiziyle kesinleşecek.

29. **`payment_type='mixed'` deprecate** (Modül 10 kararı): v3'te `mixed` + `other` enum değerleri ambiguous, raporda satır bazlı toplam net değildi. v5'te `payment_type ∈ {cash, card}`. Karışık ödeme = iki ayrı `payments` satırı (her biri tek tip). **How to apply:** shared-types `paymentSchema` enum daraltılır; raporlar satır bazlı toplam hesaplar, `mixed` union gerekmez.

30. **İskonto MVP'den çıkarma → v5.1 — kapsam küçültme ADR-XXX zorunlu** (Kullanıcı kararı Modül 10): Charter v5.0 MVP'de "iskonto (limit altı kasiyerde, limit üstü admin onayı)" yazıyordu; v3'te `orders.discount_amount` + `order_items.discount_amount` DB'de var ama `payments.js`/`orders.js` route'larında uygulama endpoint'i yok → fiilen kullanılmıyordu. "v3'te var mıydı?" sorusunun cevabı schema evet ama kullanım hayır. Pilot odağı dağılmasın, ödeme akışı sade kalsın. **How to apply:** charter "Özellikler → v5.0 MVP → Ödeme" maddesinden iskonto satırı kaldırılır, v5.1 listesine eklenir. ADR-XXX gerekçeyi belgeler. Kasiyer limit kuralı da iskonto ile birlikte v5.1'e; MVP'de tüm refund admin onayı (limit yok).

31. **Refund MVP = tam iptal, kısmi refund v5.1** (Modül 10 kararı): Kısmi refund tutar hesabı (ikram + parçalı ödeme + iskonto v5.1 geldikten sonra) karmaşık; pilotta önce basit model (siparişin tamamı iade) denenir. **How to apply:** `refunds.amount_cents = payments.amount_cents toplamı`; kısmi allocation iade v5.1.

## Session 6 kapanış özeti (2026-04-22)

**Tamamlanan:**
- Modül 10 — Ödeme (tam dolu, v3 `migrations/run.js:255-305` şemasıyla teyit)
- 3 yeni mimari sinyal (toplam 31): #29 mixed deprecate, #30 iskonto MVP→v5.1 kapsam küçültme, #31 refund tam iptal MVP
- v3 reference ilerleme: %60 → %67 (9/15 → 10/15)

**Kritik kapsam kararı:**
- **İskonto MVP'den çıkarıldı → v5.1 (Sinyal #30)** — kapsam küçültme ADR-XXX + charter güncellemesi zorunlu. Gerekçe: v3 şemada var ama route/UI yok, fiilen kullanılmıyor; pilot odağı dağılmasın
- v3'te `payments.discount_amount` alanı schema'da korunur ama MVP'de always 0; v5.1'de UI ve route eklenir

**Modül 10'dan çıkan diğer kararlar:**
- Yalnız `*_cents` integer (Sinyal #21 netleşti)
- `payment_type ∈ {cash, card}` (mixed + other deprecate)
- Karışık ödeme = iki ayrı `payments` satırı
- Kalem bazlı parçalı ödeme UI: checkbox → "Seçilenleri öde"
- Para üstü `tendered_cents` alanı
- Ödeme öncesi iptal = `orders.status='cancelled'`; sonrası = `refunds` satırı + admin onay + neden + audit
- Refund MVP = tam iptal; kısmi refund v5.1
- Idempotency server-side zorunlu + UI optimistic lock

**Açık ADR borçları:**
- ADR-001 Monorepo (Phase 0)
- ADR-002 Auth (Phase 0)
- ADR-003 DB şema (Phase 0 sonu) ← call_logs TTL + yalnız cents + order_no + print_jobs idempotency + payments idempotency
- ADR-004 Print Agent (Phase 1 başı — kapsamı netleşti)
- **ADR-XXX İskonto MVP→v5.1 kapsam küçültme (Phase 1 başı)** ← Sinyal #30
- ADR-XXX Masa sorumlu garson + masa birleştirme (Phase 1)
- ADR-XXX Müşteri sipariş geçmişi + Excel I/O kapsam terfi (Phase 1 başı)

**Charter güncellemesi bekliyor:**
- `docs/project-charter.md` → "v5.0 MVP" → "Ödeme" maddesinden "iskonto (limit altı kasiyerde, limit üstü admin onayı)" kaldırılacak
- v5.1 listesine "İskonto (sipariş bazlı, kasiyer limit altı, üstü admin onayı)" eklenecek
- Bu değişiklik ayrı commit, ADR-XXX gerekçe

**Sıradaki:** Modül 11 — Raporlar
- Charter MVP: Z raporu (gün sonu), X raporu (dönem içi), ürün satış raporu, günlük ciro, ödeme kırılımı, masa/paket dağılımı
- v3 kaynakları: `routes/reports.js`, `services/periodCloseService.js`
- Sinyal #6 (snapshot semantiği — `GROUP BY oi.product_name`) bu modülde pekişecek
- Sinyal #29 (payment_type satır bazlı) rapor hesabı için kritik

## Session 7 starter prompt — Modül 11 başlangıç

```
[Tarih]. Restoran POS v5 Session 7'ye başlıyorum.

Önce bağlamı kur:
1. CLAUDE.md — v3 referans erişimi + snapshot semantiği (Sinyal #6)
2. .claude/plans/active-plan.md — durum (%67, 10/15)
3. .claude/memory/scratchpad.md — sinyaller #1-31 + Session 6 kapanış + iskonto ADR borcu
4. docs/v3-reference/modules.md — Modül 7 (snapshot) + Modül 10 (payment_type satır bazlı)

Session 7 görevi: Modül 11 — Raporlar röportajı.
- Charter MVP: Z raporu, X raporu, ürün satış, günlük ciro, ödeme kırılımı, masa/paket
- v3 kaynakları: routes/reports.js, services/periodCloseService.js, dashboard.js
- Sinyal #6 (product_name snapshot) + #29 (payment_type satır bazlı) bu modülde pekişecek
- AskUserQuestion şıklı format
- Sub-agent yerine direkt Read/Grep

Kod yazma, dosya oluşturma, commit atma yapma. Önce bağlamı kur, "hazırım" de, onayla Modül 11 A sorusuna geç.
```

## Session 5 kapanış özeti (2026-04-22)

**Tamamlanan:**
- Modül 9 — Yazıcı / Print Agent (tam dolu, v3 `migrations/run.js:328-365`, `encodePC857.test.js`, print_jobs şeması teyidiyle)
- 3 yeni mimari sinyal (toplam 28): #26 print timeout kasa uyarı, #27 yazıcı sayısı runtime değişken, #28 CP857 `ESC t 13` eksikliği hipotezi
- v3 reference ilerleme: %53 → %60 (8/15 → 9/15)
- ADR-004 (Print Agent) için kapsam tam netleşti

**Modül 9'dan çıkan kritik kararlar:**
- Print Agent ayrı Windows servisi, ayrı versiyonlanır (StoreBridge'in aksine web/mobile update'inden izole) — charter "sürüm güncellemesi yazıcıyı bozmasın" hedefini doğrudan çözer
- Print Agent = Yazıcı + Caller ID forward tek servis (Sinyal #18 pekişti)
- Hibrit iletişim: Socket push + pull fallback, idempotency_key ile çift basım sıfır
- CP857 düzeltmesi: her baskı öncesi zorunlu `ESC @ + ESC t 13` preamble; v3 encoder byte tablosu domain referansı
- Kitchen adjustment fişi: ayrı fiş, kırmızı "İPTAL"/"AZALTILDI" başlık, before/after snapshot
- 20 sn timeout → kasa toast + ses uyarısı; 2 auto retry (5+15 sn)
- Yazıcı CRUD sadece admin; sayı runtime değişken; zero-config wizard ilk kurulumda

**Açık ADR borçları:**
- ADR-001 Monorepo (Phase 0)
- ADR-002 Auth (Phase 0)
- ADR-003 DB şema (Phase 0 sonu) ← call_logs TTL + yalnız cents + order_no pattern + print_jobs idempotency
- **ADR-004 Print Agent mimarisi (Phase 1 başı) ← KAPSAMI TAM NETLEŞTİ:** ayrı Windows servisi / hibrit iletişim (socket+pull) / ESC @ ESC t 13 preamble / UTF-8→CP857 tek katman / idempotency_key / 20 sn timeout + kasa toast / Caller ID forward dahil / yazıcı CRUD + zero-config wizard / 4 job tipi (receipt/kitchen/adjustment/label)
- ADR-XXX Masa sorumlu garson + masa birleştirme (Phase 1)
- ADR-XXX Müşteri sipariş geçmişi + Excel I/O kapsam terfi (Phase 1 başı)
- ADR-XXX İskonto akışı ve rol limitleri (Phase 1, Ödeme sonrası)

**Sıradaki:** Modül 10 — Ödeme
- Charter MVP: parçalı ödeme (nakit + kart karışık, birden fazla müşteri ayrı), ikram, iskonto (kasiyer limit altı, admin üstü), iptal (neden zorunlu + audit)
- Sinyal #21 (yalnız cents, float yasak) bu modülde pekişecek
- İskonto akışı bu modülde netleşecek (Modül 7 açık ucu kapanır)
- v3 kaynakları: `routes/payments.js`, `services/paymentService.js`, `services/refundService.js`
- ADR adayları: parçalı ödeme veri modeli (payments tablosu vs payment_allocations), iskonto rol limitleri

## Session 6 starter prompt — Modül 10 başlangıç

```
[Tarih]. Restoran POS v5 Session 6'ya başlıyorum.

Önce bağlamı kur:
1. CLAUDE.md — v3 referans erişimi + para birimi kuralı (yalnız cents/kuruş)
2. .claude/plans/active-plan.md — durum (%60, 9/15)
3. .claude/memory/scratchpad.md — sinyaller #1-28 + Session 5 kapanış
4. docs/v3-reference/modules.md — Modül 7 (İskonto belirsizliği) + Modül 9 (receipt print job)

Session 6 görevi: Modül 10 — Ödeme röportajı.
- Charter MVP: parçalı ödeme (nakit+kart karışık, birden fazla müşteri ayrı), ikram, iskonto (kasiyer/admin limit), iptal
- Sinyal #21 netleşme: yalnız cents, float yasak
- İskonto açık ucu (Modül 7) bu modülde kapanır
- v3 kaynakları: routes/payments.js, services/paymentService.js, services/refundService.js
- AskUserQuestion formatı (şıklı)
- Sub-agent yerine direkt Read/Grep

Kod yazma, dosya oluşturma, commit atma yapma. Önce bağlamı kur, "hazırım" de, onayla Modül 10 A sorusuna geç.
```

## Session 4 kapanış özeti (2026-04-22)

**Tamamlanan:**
- Modül 8 — Mutfak Ekranı (KDS) (tam dolu, v3 `KitchenScreen.jsx` koduyla teyit)
- 2 yeni mimari sinyal (toplam 25): #24 mutfakta cihaz yok + Print Agent %95 çözer, #25 KDS kartında fiyat yok
- v3 reference ilerleme: %47 → %53 (7/15 → 8/15)
- Kapsam teyidi: Mutfak ekranı MVP'de kalır (charter uyumlu) ama operasyonel zorunluluk değil — v3 pariteli kod, pilot sonrası kullanım değerlendirilir

**Modül 8'den çıkan kritik karar:**
- v3 KDS kodu tüm özellikleriyle mevcut (aging 10/20 dk, Web Audio bip, kalem ready işaretleme) ama mutfakta cihaz yok → hiç kullanılmadı
- v5'te fiş ana araç olarak kalır; ekran opsiyonel admin PC tab'ı veya ileride tablet
- Kitchen adjustment görselleştirme (Sinyal #22) MVP'de yapılır — iptal üstü çizili + kırmızı rozet + farklı ses; azaltma delta + rozet
- Fiyat kartta gösterilmez (rol prensibi — Sinyal #25)

**Açık ADR borçları (değişmedi):**
- ADR-001 Monorepo (Phase 0)
- ADR-002 Auth (Phase 0)
- ADR-003 DB şema (Phase 0 sonu) ← call_logs TTL + yalnız cents + order_no pattern
- ADR-004 Print Agent mimarisi (Phase 1 başı) ← Caller ID forward + kitchen adjustment job protokolü
- ADR-XXX Masa sorumlu garson + masa birleştirme (`order_tables` junction) (Phase 1)
- ADR-XXX Müşteri sipariş geçmişi + Excel I/O kapsam terfi (Phase 1 başı)
- ADR-XXX İskonto akışı ve rol limitleri (Phase 1, Ödeme sonrası)

**Sıradaki:** Modül 9 — Yazıcı / Print Agent
- ADR-004'ün domain girdisi; v3'teki 3 yazıcı routing + CP857 Türkçe karakter pain point burada netleşecek
- v3'te `printRouting.js`, `printJobs.js`, `printer.js`, `printerAutoPrintPolicy.js` zaten keşfedildi — ana kaynaklar hazır
- Sinyal #8 (yazıcı çift mekanizma → MVP'de tek = kategori routing) bu modülde pekiştirilecek
- Sinyal #22 (kitchen adjustment job protokolü) Print Agent kapsamında netleşecek
- Charter MVP: Print Agent Windows servisi, ESC/POS + CP857, 3 yazıcı routing (adisyon/mutfak/bar), yazıcı durumu monitoring

## Session 5 starter prompt — Modül 9 başlangıç

```
[Tarih]. Restoran POS v5 Session 5'e başlıyorum.

Önce bağlamı kur:
1. CLAUDE.md — v3 referans erişimi + "yazıcı sıfırdan yazılır (ADR-004)" memory
2. .claude/plans/active-plan.md — durum (%53, 8/15)
3. .claude/memory/scratchpad.md — sinyaller #1-25 + Session 4 kapanış
4. docs/v3-reference/modules.md — Modül 3 yazıcı routing bağı + Modül 7 print job + Modül 8 adjustment

Session 5 görevi: Modül 9 — Yazıcı / Print Agent röportajı.
- v3 kaynakları: printRouting.js, printJobs.js, printer.js, printerAutoPrintPolicy.js, bridge.js
- ADR-004 doğrudan bu modülden beslenecek — Print Agent = yazıcı + Caller ID forward (Sinyal #18)
- Pain point: 3 yazıcıda Türkçe karakter bozuk (CP857), fiş düzeni bozuk, sürüm güncellemesi yazıcıyı bozuyor
- MVP: 3 yazıcı routing (adisyon/mutfak/bar), kategori bazlı tek mekanizma (Sinyal #8), kitchen adjustment job (Sinyal #22), health monitoring + retry
- AskUserQuestion formatı
- Sub-agent yerine direkt Read/Grep

Kod yazma, dosya oluşturma, commit atma yapma. Önce bağlamı kur, "hazırım" de, onayla Modül 9 A sorusuna geç.
```

## Session 3 kapanış özeti (2026-04-22)

**Tamamlanan:**
- Modül 5 — Müşteri (CRM temeli) (tam dolu, v3 koduyla teyit)
- Modül 6 — Caller ID (tam dolu, v3 koduyla teyit)
- Modül 7 — Sipariş (dine-in + paket) (tam dolu, v3 koduyla teyit)
- 10 yeni mimari sinyal (toplam 23): #14-17 Müşteri, #18-20 Caller ID, #21-23 Sipariş
- v3 reference ilerleme: %27 → %47 (4/15 → 7/15)
- AskUserQuestion formatıyla interaktif röportaj akışı başarıyla yerleşti

**Kapsam terfileri (ADR bekleyen):**
- Sipariş geçmişi müşteri detayında (charter v5.1 → MVP) — Modül 5
- Excel import/export (charter v5.1 → MVP) — Modül 5

**Açık ADR borçları:**
- ADR-001 Monorepo (Phase 0)
- ADR-002 Auth (Phase 0)
- ADR-003 DB şema (Phase 0 sonu) ← call_logs TTL + cleanup cron + yalnız cents + order_no pattern eklenecek
- ADR-004 Print Agent mimarisi (Phase 1 başı) ← Caller ID forward + kitchen adjustment job protokolü kapsama dahil
- ADR-XXX Masa sorumlu garson + masa birleştirme (`order_tables` junction) (Phase 1)
- ADR-XXX Müşteri sipariş geçmişi + Excel I/O kapsam terfi (Phase 1 başı)
- ADR-XXX İskonto akışı ve rol limitleri (Ödeme modülünden sonra, Phase 1)

**Sıradaki:** Modül 8 — Mutfak Ekranı (KDS)
- Modül 7'deki Socket.IO event'leri (`order:*`) bu modülün ana beslemesi
- Yeni sipariş sesli uyarı, kalem bazlı "hazır" işaretleme (charter MVP)
- Büyük ekran tarayıcı (mutfak rolü)

## Session 4 starter prompt — Modül 8 başlangıç

```
[Tarih]. Restoran POS v5 Session 4'e başlıyorum.

Önce bağlamı kur:
1. CLAUDE.md — v3 referans erişimi bölümü
2. .claude/plans/active-plan.md — durum (%47, 7/15)
3. .claude/memory/scratchpad.md — sinyaller #1-23 + Session 3 kapanış
4. docs/v3-reference/modules.md — Modül 7 (Sipariş) format referansı

Session 4 görevi: Modül 8 — Mutfak Ekranı (KDS) röportajı.
- Modül 7'deki Socket.IO event'leri (`order:created/items_added/updated/item_updated`) bu modülün ana beslemesi
- Charter: "yeni sipariş sesli uyarı, kalem bazlı 'hazır' işaretleme" (v5.0 MVP)
- Büyük ekran tarayıcı (mutfak rolü)
- AskUserQuestion formatı (interaktif seçim)
- v3: D:\dev\restoran-pos-v3\server\routes\kitchen.js (varsa) — önce glob et
- Etiketleme kuralı: Kodda tespit / Kullanıcı gözlemi / Doğrulanmamış

Kod yazma, dosya oluşturma, commit atma yapma. Önce bağlamı kur, özetle, "hazırım" de, kullanıcı onaylayınca Modül 8 A sorusuna geç.
```

---

## Session 2 kapanış özeti (2026-04-22)

**Tamamlanan:**
- Modül 3 — Menü (tam dolu, v3 koduyla teyit: `attributes.js`, `products.js`, `printRouting.js`, `reports.js`)
- Modül 4 — Masa Yönetimi + Salon Bölgeleri (tam dolu, v3 koduyla teyit: `tables.js`, `orders.js`, `admin.js`, `reports.js`)
- 9 yeni mimari sinyal (toplam 13): özellik grubu ikili atama, snapshot semantiği, hibrit silme pattern, yazıcı çift mekanizma, garson atama eksikliği, masa birleştirme, tek masa = tek adisyon kuralı, order_type enum, hedef masa sayısı mekaniği
- v3 reference ilerleme: %13 → %27 (2/15 → 4/15)

**Açık ADR borçları (değişmedi):**
- ADR-001 Monorepo (Phase 0)
- ADR-002 Auth (Phase 0)
- ADR-003 DB şema (Phase 0 sonu)
- ADR-004 Print Agent mimarisi (Phase 1 başı)

**Yeni ADR adayı:**
- Masa sorumlu garson modeli (Modül 4 mimari sinyal #9) + Masa birleştirme veri modeli (sinyal #10) — Phase 1'de shared-domain tasarımıyla birlikte ele alınacak.

**Modül 4'ten çıkan MVP düzeltmeleri:**
- Garson atama modeli eklenir (v3 eksiği)
- Masa birleştirme MVP'ye alındı (v3'te yoktu)
- Tek masa = tek adisyon kuralı yazılı olacak
- Yazdırma sorunları Modül 9'da ele alınacak

**Hâlâ doğrulanmamış (Phase 1'de bakılacak):**
- Aynı masada paralel sipariş mümkün mü (tahminen hayır, test yok)
- Menü modülündeki fiş çıktısında özellik basılıyor mu (Modül 9'da netleşecek)
- Barkod alanının işlevsel bağlantısı

## Session 3 starter prompt — Modül 5 başlangıç

```
[Tarih]. Restoran POS v5 Session 3'e başlıyorum.

Önce bağlamı kur, şu dosyaları sırayla oku:
1. CLAUDE.md — proje anayasası (özellikle "v3 referans erişimi" bölümü)
2. docs/project-charter.md — Kapsam + Phase Roadmap
3. .claude/plans/active-plan.md — aktif durum, Session 3 görevi (%27, 4/15)
4. .claude/memory/scratchpad.md — Session 1-2 kapanış + 13 mimari sinyal + ADR-002 açık kararlar
5. docs/v3-reference/modules.md — Modül 1-4 format referansı

Session 3 görevi: Modül 5 — Müşteri (CRM temel) röportajı (v3 reference görev 2 devam).
- Standart 4 soru (A/B/C/D)
- D bölümü üçlü tasnif (v3 ile aynı / sadeleştirilmiş / v5.1 / non-goal)
- Bağımlılıklar tablo formatında (header + |---|---|)
- v3 erişimi D:\dev\restoran-pos-v3\ — read-only, copy-paste yasak, etiketleme kuralı (Kodda tespit / Kullanıcı gözlemi / Doğrulanmamış)
- Sub-agent yerine direkt Read/Grep (Session 2 öğretisi: sub-agent'ı bekleyemiyoruz)
- Her modül sonrası içeriği göster, kullanıcı onayı bekle (disiplin)

Kod yazma, dosya oluşturma, commit atma yapma. Önce bağlamı kur, özetle, "hazırım" de, kullanıcı onaylayınca Modül 5 A sorusuna geç.

İpucu: Modül 5 sonrası Modül 6 (Caller ID) gelir; Modül 4'te Caller ID UI akışı çoğunlukla doldu (popup + son 7 gün geçmişi + Siparişi Aç) — Modül 6'da detay teknik ve backend odaklı olabilir.
```

## Session 1 kapanış özeti (2026-04-22)

**Tamamlanan:**
- Bootstrap (v4'ten taşıma + yeniden yazımlar — önceki oturumlardan)
- Stratejik kararlar: yazıcı sıfırdan yazılır (ADR-004 Phase 1'e borç) + basit UI prensibi (iki seviye + zero-config)
- HCI checklist güncelleme (Basit UI & Sıfır Yapılandırma bölümü + anti-örnek)
- `simple-first-ui` skill iskeleti (detay Phase 0 sonunda dolacak)
- Modül 1 — Ayarlar (tam dolu)
- Modül 2 — Auth/Login (tam dolu, v3 koduyla teyit edildi)
- v3 erişim kuralları CLAUDE.md'ye eklendi + path consistency
- ADR-004 Phase 1 notu active-plan'a eklendi
- Commit'ler: `b4d308b`, `25e395f`, `259b102`

**Açık ADR borçları:**
- ADR-001 Monorepo (Phase 0)
- ADR-002 Auth — şifre reset hibrit, token süreleri, rol matrisi config (Phase 0)
- ADR-003 DB şema (Phase 0 sonu)
- ADR-004 Print Agent mimarisi (Phase 1 başı)

**Açık kararlar listesi:**
- ADR-002 hibrit şifre reset: admin reset MVP, email endpoint ready-but-disabled, v5.1 flag

**Hâlâ bilinmeyen (Phase 1'de bakılacak):**
- v3 logout davranışı (buton var, akış test edilmedi)
- Oturum timeout
- Backend route guard varlığı (frontend filter kesin, backend belirsiz)

## Session 2 starter prompt — Modül 3 başlangıç

```
[Tarih]. Restoran POS v5 Session 2'ye başlıyorum.

Önce bağlamı kur, şu dosyaları sırayla oku:
1. CLAUDE.md — proje anayasası (özellikle "v3 referans erişimi" bölümü)
2. docs/project-charter.md — Kapsam (v5.0 MVP / v5.1 / v5.2+ / non-goal) + Phase Roadmap
3. .claude/plans/active-plan.md — aktif durum, Session 2 görevi
4. .claude/memory/scratchpad.md — Session 1 kapanış özeti + v3 mimari sinyaller + ADR-002 açık kararlar
5. docs/v3-reference/modules.md — Modül 1-2 tamamlanmış, format referansı

Session 2 görevi: Modül 3 — Menü röportajı (v3 reference görev 2 devam).
- Standart 4 soru (A/B/C/D)
- D bölümü üçlü tasnif (v3 ile aynı / sadeleştirilmiş / v5.1 / non-goal)
- Bağımlılıklar tablo formatında (header + |---|---|)
- v3 erişimi D:\dev\restoran-pos-v3\ — read-only, copy-paste yasak, etiketleme kuralı (Kodda tespit / Kullanıcı gözlemi / Doğrulanmamış)
- Her modül sonrası içeriği göster, kullanıcı onayı bekle (disiplin)

Kod yazma, dosya oluşturma, commit atma yapma. Önce bağlamı kur, özetle, "hazırım" de, kullanıcı onaylayınca Modül 3 A sorusuna geç.
```

## Phase 0 sonunda taşınacaklar

<!-- Bu liste Phase 0 kapanışında decisions.md'ye veya ilgili docs'a taşınır -->

- ADR-001: Monorepo yapısı ve paket isimlendirme
- ADR-002: Auth stratejisi (JWT access + refresh, cookie mi header mı)
- ADR-003: DB şema ilkeleri (`tenant_id` konvansiyonu, id tipi, timestamp tipi)
- ADR-004: Print Agent mimari (cloud pull mı push mı, queue, retry)
- ADR-005: Web UI state management (TanStack Query + Zustand mı, başka mı)
