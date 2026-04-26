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

## Lokal dev gotchas (Windows, Session 21)

<!-- Yeni geliştirici makinesinde Phase 0 bootstrap çalıştırmak için bilinmesi gerekenler -->

- **pnpm 9 zorunlu** — `package.json` `engines.pnpm: ">=9.0.0 <10.0.0"` ve `packageManager: pnpm@9.15.9`. Yerel pnpm 10 varsa **yönetici PowerShell**'de:
  ```powershell
  corepack enable
  corepack prepare pnpm@9.15.9 --activate
  ```
- **`manage-package-manager-versions=false`** — pnpm 10 yan yana koşulları için `cd $HOME && pnpm config set manage-package-manager-versions false` (proje dizininde çalıştırma — packageManager loop'u kırmaz)
- **`kysely-codegen` Windows'ta `$DATABASE_URL` expand etmiyor** — npm script CI Linux'ta çalışır, lokalde doğrudan binary çağrısı:
  ```bash
  cd packages/db && node_modules/.bin/kysely-codegen \
    --url "postgresql://postgres:postgres@localhost:5432/pos_dev" \
    --out-file src/generated.ts
  ```
- **Docker Desktop volume lokasyonu** — varsayılan C:\Users\<user>\AppData\Local\Docker\wsl\data\ext4.vhd. D:'ye taşımak için Settings → Resources → Disk image location, veya `docker-compose.yml`'de bind mount (`D:/docker-volumes/restoran-pos/postgres:/var/lib/postgresql/data`)
- **`engine-strict=true` `.npmrc`'de** — engines uyumsuzluğu install'u durdurur, bypass yok (kasıtlı)
- **CI ↔ lokal codegen drift** — `git diff --exit-code packages/db/src/generated.ts` Migration Check workflow gate'i. Şema değişikliğinde lokalde codegen çalıştır + commit, yoksa CI fail.

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

32. **Yazarkasa Z ≠ POS "günlük kapanış"** (Modül 11 kullanıcı teyit): v3'te `period_z_close` audit kodu kullanıcıyı yanılttı. Yazarkasa Z raporu yasal/fiziksel, kullanıcı her gün yazarkasadan manuel alıyor — POS kapsamı dışı. POS tarafı = "günlük kapanış" (state kilidi + özet). Restoran PC'si gece kapatıldığı için **otomatik cron zorunlu**: işletme kapanış saati (Ayarlar) + 2 saat. Fiş/PDF çıktısı yok, sadece ekran. **How to apply:** v5 terminoloji `daily_close` (period_z_close değil); cron cloud backend'de (node-cron veya pg_cron), saat ayarı `business_settings.closing_time`.

33. **Günlük kapanış hibrit storage + post-kapanış override** (Modül 11 kararı): v3 `period_closes` tablosu korunur. Bugünün özeti canlı SUM (tablo satırı yok); gün kapandığında satır oluşur (`totals JSON`, `closed_at`, `closed_by` = 'system-cron' | user_id). Kapandıktan sonra düzeltme gerekirse admin parola + neden + audit; günlük özet revize edilir. **How to apply:** ADR-003 DB şemaya `period_closes` + admin override akışı ADR-XXX (Phase 1 başı).

34. **Kullanıcı performans raporu için created_by/processed_by zorunlu** (Modül 11 kapsam terfi): `orders.created_by` (v3'te var), `payments.processed_by` veya `payments.created_by` alanları auth ile bağlı. v3'te `payments.created_by` mevcut (Kodda tespit `reports.js:84`). Sinyal #9 (masa sorumlu garson) ile çelişki potansiyeli: garson atama modeli netleşmeden "sipariş kimindi" soyut kalır. Pilotta tek kullanıcı (admin kendisi) → pratik etki minimal, altyapı Phase 2 mobil garson için hazır olur. **How to apply:** ADR-003'te `orders.created_by` + `payments.created_by` + `refunds.approved_by` zorunlu kolonlar; Auth ADR-002 ile çapraz referans.

35. **Kategori snapshot v3'te hazır** (Modül 11 Kodda tespit): v3 `order_items.category_id_snapshot` + `category_name_snapshot` kolonları zaten mevcut (`reports.js:76`). Sinyal #6'nın (ürün adı snapshot) kategori karşılığı — menü rename eski raporu etkilemez. v5 ADR-003'te aynen korunur; Kategori raporu (kapsam terfi) bu snapshot'lar üzerinden çalışır. **How to apply:** Shared-domain Order entity'sinde kalem oluştururken category_id + category_name anında dondurulur.

36. **CSV export generic middleware** (Modül 11 kapsam terfi): Her rapor endpoint'i için ayrı CSV route değil; `?format=csv` query param ile Express middleware içinde JSON → CSV dönüştürür. Sinyal #17 (müşteri Excel I/O v5.1→MVP terfi) ile paralel; ortak util `packages/shared-domain/csv.ts` veya API middleware. **How to apply:** ADR adayı "rapor export protokolü" (Phase 1) — Content-Type negotiation, BOM (Excel Türkçe uyumu), CP1254 vs UTF-8 karar.

37. **Rezervasyon seat akışı pattern değerli** (Modül 12 Kodda tespit): v3 `POST /reservations/:id/seat` → `orders` tablosuna yeni sipariş + `reservations.seated_order_id` FK. Rezervasyon "tüketildiğinde" masa açılır, sipariş normal akışa girer. Modül 12 MVP'de yok (v5.1 backlog, kullanıcı pilotta nadir kullanıyor) ama v5.1 geldiğinde bu pattern korunur. **How to apply:** v5.1'de shared-domain'de `seatReservation(reservation) → Order` fonksiyonu; ADR-003 Phase 2'de `reservations` tablosu + `seated_order_id` ilişkisi.

38. **Stok modülü v5.1 → v5.2+ terfi (kapsam küçültme)** (Modül 13 kullanıcı kararı): v3'te `routes/stock.js` kodu var ama pilot restoranda pratikte kullanılmıyor (manuel sayim / göz kararı). Charter v5.1 backlog'dan çıkar, v5.2+ ufuk listesine konur — pilotta gerçek ihtiyaç doğarsa ADR ile açılır. Kapsam küçültme kazancı: v5.1 iş yükü azalır, disiplin güçlenir. **How to apply:** charter güncellemesi zorunlu (borç #3) — line 80 + 188 kaldırılır, v5.2+ bölümüne eklenir. Aynı charter update PR'ına (iskonto #30 + raporlar #32-36 + stok #38) birleştirilebilir.

39. **Audit log: kritik+finansal kapsam, 2 yıl retention, PII maskeli** (Modül 14 kullanıcı kararları): v3'teki 20+ `auditLog()` çağrısı filtrelenecek — yüksek hacim operasyonel event'ler (`print_jobs_enqueued`, `print_job_printed`) MVP'de loglanmaz, gürültü önlenir. Kritik + finansal: order create/cancel, payment, refund, daily_close, admin_override, auth, user mgmt, table_transfer, category update/delete. Retention 2 yıl + cron (`call_logs` ile birleşik job, Sinyal #20). PII: telefon son 4 maske, isim/adres yok, sadece customer_id. v3 `incoming_call` raw telefon KVKK sorunu v5'te düzeltilir. **How to apply:** shared-types `AuditAction` union whitelist; `auditLog()` helper içinde PII sanitizer (shared-domain); ADR-003 retention cron; ADR-XXX event taxonomy (Phase 1 başı).

40. **Audit actor: user_id + user_agent, IP yok** (Modül 14 kullanıcı kararı): KVKK gereği IP loglanmaz (kişisel veri); user_agent web/mobil/garson app ayırt etmek için yeterli. Session/token id pilotta gerekmiyor. Forensic ihtiyaç doğarsa v5.1'de migration ile eklenir. **How to apply:** `audit_logs(id, business_id, user_id, user_agent, action, entity_type, entity_id, details JSONB, created_at)` — IP ve session_id kolonları yok; `auditLog()` helper Express `req` context'inden user_agent alır. ADR-002 Auth ile uyumlu.

41. **Yedek ≠ veri saklama ayrımı** (Modül 15 kullanıcı kavram netleşmesi): "3 yıl önceki siparişi görmek" istediğinde yedekten restore değil, canlı DB sorgusu yapılır. v5 MVP'de silme endpoint'i yok (Sinyal #15 anonimize modeli zaten koyuyor), sipariş/müşteri/ödeme süresiz saklanır. Yedek yalnız felaket kurtarma için; 30 gün yeterli. Audit log ayrı retention (2 yıl, Sinyal #39). **How to apply:** Ops runbook'ta "yedek vs data retention" ayrımı başlık olarak yazılır; kullanıcı eğitiminde karıştırılmaz; Modül 11 Raporlar tarih aralığı UI'sı "istediğin yıla kadar" filtre sunar.

42. **Yedek politikası: Hetzner Storage Box + günlük pg_dump + 30 gün + E2E şifreleme + aylık restore test** (Modül 15 kullanıcı kararları): Tüm teknik parametreler kilitli. Storage Almanya (KVKK), cron işletme kapanış + 2 saat, pg_dump → gpg/age şifreleme → TLS upload, anahtar env var + 1Password master copy. RPO 24 saat, RTO ~1 saat manuel. Ayda bir staging restore + smoke checklist (kullanıcı sayısı, son sipariş, son günlük kapanış, checksum). MVP'de restore UI yok — admin SSH + pg_restore + runbook. **How to apply:** Phase 4 ADR-XXX "Yedek mimarisi" — cron spec, encryption pipeline, Storage Box entegrasyonu, `docs/ops/restore-runbook.md` SOP. v5.1'de UI (yedek listesi, tek tıkla restore, indirme). v3'te altyapı sıfır olduğu için copy-paste riski yok, sıfırdan tasarım.

## Session 10 kapanış özeti (2026-04-24)

**Tamamlanan — ADR-003 Bölüm 7-9 verbatim onay + ek işler:**

- Bölüm 7 (Snapshot İnvaryantı) — verbatim sunuldu, kullanıcı düzeltmeleri (category_name_snapshot trigger sütunu "—", trigger notu sadeleştirildi), onay alındı, Edit kilit
- Bölüm 8 (Soft vs Hard Delete) — verbatim sunuldu, 2 düzeltme (§8.4 ON DELETE RESTRICT gerekçesi + §8.5 default filter kuralı), sonra tool tutarlılığı turu (§8.5 "drizzle-kit ORM helper" → "repository helper", tool-agnostik), onay alındı, Edit kilit
- Bölüm 9 (Enum Kullanımı) — external Claude.ai review (9 nokta) → kullanıcıya plain-language 3 domain sorusu → kararlar: (soru 1a) delivery ayrı `order_type` değeri + MVP kurye tracking yok, (soru 2a+öneri) `equal_split` eklendi küsurat son satıra, (soru 3d) `print_job_status.cancelled` + `failed` ayrımı. `payment_type meal_card` eklenmedi (kabul edilmiyor). §9.1 final enum listesi, §9.2.1 4 domain gerekçesi, §9.3 catering ADD VALUE örneği, §9.3 RENAME "koşullu"→"yasak", §9.5(b) agent dosyası referansı somutlaştı, §9.2.1 v3→v5 geçiş notu eklendi. Onay alındı, Edit kilit.
- `CLAUDE.md` Core Directive #7 "Cerrahi değişiklik" eklendi (Karpathy CLAUDE.md §3 adapt; prompt injection niyetiyle gelen curl-append reddedildi, fetch→review→integrate güvenli yol uygulandı)
- `docs/context-anchor.md` oluşturuldu — yeni Claude.ai sohbetleri için 6 bölümlü tutarlılık çapası (Proje özeti, Şimdi neredeyiz, Claude.ai rolü, Sabit kararlar, Yaygın tuzaklar, Kalite kontrol checklist)

**Toplam revizyon turu sayısı:** 7
1. Bölüm 7 düzeltmeleri (trigger sütunu + not sadeleştirme)
2. Bölüm 8 düzeltmeleri (§8.4 RESTRICT + §8.5 default filter)
3. Tool tutarlılığı turu (Bölüm 7/8 drizzle/kysely/ORM araması — §8.5 fix)
4. `context-anchor.md` 4 düzeltme (kullanım notu yer, timeline doğrulama, §3 çıktı akışı, §6 trigger not sadeleştirme)
5. Bölüm 9 external review sonrası 3 enum değeri + 1 rename label düzeltmesi
6. Bölüm 9 son 3 düzeltme (§9.3 catering, §9.5(b) agent verify, §9.2.1 v3→v5 not)
7. Session kapanış protokolü bu session

**Kritik kararlar (ADR-003 içinde kilitli, Session 10'da onaylanan):**
- `order_type.delivery` **ayrı enum değeri** (v3'te takeaway tek akıştı, v5'te ayrıştı) — MVP kurye tracking yok, kimlik/çıkış saati tutulmuyor, v5.1 ADR'de eklenir
- `payment_scope.equal_split` ("adam başı böl") eklendi; küsurat son satır kuralı; masayı N'e böl UI input
- `payment_type` = `cash` + `card` (yemek kartı MVP'de yok, ilerde ADD VALUE)
- `print_job_status.cancelled` + `failed` ayrımı (operatör iptali vs yazıcı hatası; retry/audit davranışı farklı)
- Enum REMOVE/REORDER/RENAME **yasak** (PG limitasyonu + ADR disiplini; RENAME için "koşullu" etiketi kaldırıldı)
- `ALTER TYPE ADD VALUE` + DML **aynı PR'da yasak** (db-migration-guard BLOCKER + best-effort regex)
- Forward-only, rollback yok, out-of-order deploy yasak

**Açık ADR borçları (Session 11+):**
- Bölüm 10 Ödeme Modeli & İnvaryantları — 3 scope (full_order/split_item/equal_split) + ikram 3-trigger enforcement + delivery ödeme zamanlaması
- Bölüm 11 order_no Günlük Unique
- Bölüm 12 Audit Log Şema Kontratı — kritik, db-migration-guard review
- Bölüm 13 Retention & TTL Cleanup
- Bölüm 14 Kritik Index'ler — db-migration-guard review
- Bölüm 15 Migration Stratejisi + tool seçimi
- Bölüm 16 Consequences

**ADR-003 dışı açık borçlar (DoD bekliyor, ADR kabul sonrası):**
- `apps/api/migrations/000_init.sql` şablon migration
- `packages/db` boilerplate
- `packages/db/tests/store-date-parity.test.ts` skeleton
- `pnpm db:types` komutu (kysely-codegen setup)

**Follow-up task'lar (ADR commit sonrası, AYRI PR):**
- `docs/v3-reference/data-model.md` drift düzeltmesi (customer_phones UNIQUE + hard delete + ADR-003 §6.2/§8.3 atıf) — `active-plan.md` Follow-up'ta kayıtlı
- **v3→v5 takeaway/delivery backfill ADR'si (Phase 5 geçiş planı)** — YENİ açık borç, §9.2.1 kararıyla doğdu; `active-plan.md` Follow-up'a eklendi

**Phase 0 exit kriterleri durumu:**
Phase 0 **açık**. ADR-003 Bölüm 1-9 onaylı (9/16); Bölüm 10-16 henüz yazılmadı. ADR-001 + ADR-002 + CI + hello endpoint + monorepo iskeleti yapılmadı. Phase 1'e geçiş kriterlerinden uzağız.

**Verbatim kontrol durumu (net):**
- Bölüm 1-9 — hepsi verbatim onaylı, Edit kilit
- Bölüm 10-16 — yazılmadı

**Sıradaki (Session 11 sırası):**
1. Bölüm 10 Ödeme Modeli & İnvaryantları draft — parça parça verbatim sunum → onay
2. Bölüm 11-16 sırayla
3. ADR kabul → `apps/api/migrations/000_init.sql` + `packages/db` boilerplate + parity test skeleton
4. AYRI PR: data-model.md drift düzeltmesi
5. ADR-001 → ADR-002 → CI → hello endpoint (Phase 0 exit)

## Session 11 — çalışma notları (2026-04-24, in progress)

**§10.1 kilitli kararlar (verbatim onay bekliyor):**
- `full_order` tek `payment_type` taşır; pilot restoranda karışık tek-ödeme yaşanmıyor → 4. scope eklenmedi (split_amount vb. YOK). Kuraldışı senaryo çıkarsa v5.1 ADR
- `split_item`: `is_comped=true` order_items `payment_items` junction'a EKLENMEZ; UI'da "İkram" rozetiyle disabled görünür; invariant yalnız `is_comped=false` kalemler üzerinden
- `split_item` enforcement: UI + `OrderService.closeOrder` + DB katmanı (çift kontrollü); detay §10.4
- `payment_scope` ve `payment_type` ortogonal (CHECK constraint yok, matris açık)
- Junction tablosu: `payment_items(payment_id, order_item_id, tenant_id)` PK composite + `UNIQUE(order_item_id)` tam unique (partial değil)
- `equal_split` N değişikliği: satırlar üretildikten sonra N doğrudan düzenlenemez; yanlış N → mevcut satırlar iptal + "Eşit Böl" yeniden tetikle. Satır ekleme/silme UI'da kapalı. MVP kararı: basit akış; N re-calculation UI v5.1'e

**§10.2'de kilitlenecek (§10.1 takip notları):**
- `orders.total_cents` net/gross tanımı (ikram öncesi/sonrası hangisi)
- `is_fully_comped=true` siparişte `payments` davranışı (sıfır payment satırı mı, tek sıfır satır mı)
- `equal_split` manuel override sonrası scope değişmez; `is_manually_adjusted` kolonu MVP'de YOK (v5.1 ihtiyaç çıkarsa)
- `equal_split` N üst sınırı MVP'de YOK (kasiyer disiplini yeterli, 25 masalı restoran)

**§10.2 kilitli kararlar (verbatim onaylı ✅, decisions.md'ye yazılacak):**
- `orders.total_cents = GROSS` (tüm order_items toplamı, is_comped'ten bağımsız); `comped_amount_cents` ayrı kolon; payable = total − comped. Alternatif NET reddedildi (snapshot stability + rapor tek-kaynak)
- T1 trigger: `is_fully_comped=true` geçişinde tüm order_items otomatik `is_comped=true` (AFTER UPDATE OF is_fully_comped). Ters yön (tek tek ikram + fully_comped=false) kabul edilir
- T2 trigger: `order_items.is_comped` değişince `comped_amount_cents` otomatik recompute (DB otoriter; domain elle yazmaz)
- T3 trigger: `is_fully_comped` rollback engeli (true→false yasak; RAISE EXCEPTION; cancel yolu ayrı)
- `is_fully_comped=true` siparişte `payments` satır sayısı = **0** (yokluk; sıfır tutarlı tek satır reddedildi — enum anlamsız değer taşımasın)
- `OrderCompService` yalnız `admin` rolü; NOT NULL `reason`; audit log zorunlu; idempotent; `uncomp*` MVP'de YOK (v5.1)
- Item-level `is_comped` rollback DB trigger ile bloklanmaz (admin cancel+reopen yolu kullanır; v5.1 `uncompItem`)
- Kısmi iptal (tek kalem iptal) kapsam dışı — `order_items.is_cancelled` MVP'de YOK; pilot senaryoda yaşanmıyor; v5.1 ihtiyaç çıkarsa ayrı ADR

**§10.3'e devredilen takip:**
- `order_type=delivery` ödeme zamanlaması (kapıda ödeme tek senaryo; önceden ödeme v5.1); kurye tracking yok

**§10.3 domain notları (ADR'ye EKLENMEZ — kapsam kilidi):**
- Kapıda ödeme reddi senaryosu pilot restoranda hiç yaşanmadı. Yaşanırsa işletme sahibi (İlhan) farkı kendi cebinden kasaya ekler; sistem açısından normal nakit ödeme gibi işlenir (payments satırı standart). Özel DB kuralı/kolon yok
- Terminoloji tutarlılığı: "taşınabilir POS" yerine "mobil POS" (sektör standart)

**§10.4 domain notları (ADR'ye forward-reference ile değinildi, detay AYRI ADR):**
- Açık kalmış yarım ödenmiş siparişlerin gün sonu temizliği = İlhan'ın restoran pratiği (A): gün sonunda kasiyere açık sipariş listesi gösterilir, teker teker kapatılır veya iptal edilir. **Otomatik kapatma YOK.** Bu akış Bölüm 15 veya ayrı bir daily-closeout ADR'sinde tanımlanacak — §10.4 yalnız forward-reference verir
- Refund akışı MVP kapsamı dışı — pilot restoranda ödeme iadesi yaşanmıyor. `refunds` tablosu MVP'de YOK. v5.1 ihtiyaç çıkarsa ayrı ADR; `payments`'ta negatif satır YOK kuralı o ADR'de de korunacak

**Açık Phase 0 borcu (Görev 6 CI/hook):**
- PostToolUse `pnpm test` hook'u isteği geldi → Phase 0 açık olduğu için reddedildi (monorepo/package.json yok, `npm` vs `pnpm` tutarsızlığı, ADR markdown edit'ini patlatır). Görev 6 (CI pipeline) başlarken doğru matcher + `pnpm` komutu + sınırlı path glob ile kurulacak

## Session 11 kapanış özeti (2026-04-24)

**Tamamlanan — ADR-003 Bölüm 10.1-10.4 verbatim onaylı:**

- §10.1 payment_scope davranışları (full_order / split_item / equal_split) — payment_items junction tablosu (PK composite + UNIQUE order_item_id), is_comped junction'a EKLENMEZ, equal_split N değişikliği iptal+yeniden tetikle akışı, §10.4 forward-reference. Edit kilit.
- §10.2 ikram enforcement — orders.total_cents = GROSS (kilitli domain kararı), comped_amount_cents ayrı kolon, is_fully_comped + is_comped iki seviyeli; T1 auto-propagation (is_fully_comped=true → tüm order_items.is_comped=true), T2 recompute, T3 rollback engeli; is_fully_comped=true → 0 payments satırı (kilitli); OrderCompService admin-only + NOT NULL reason + audit zorunlu + idempotent; uncomp* + kısmi iptal MVP dışı. Edit kilit.
- §10.3 delivery ≡ takeaway (ödeme açısından); MVP kapıda ödeme tek senaryo; kurye tracking v5.1 ADR; v3→v5 backfill Phase 5 ADR'ye atıf. Edit kilit.
- §10.4 8 invariant (I1-I8): I2/I3 SUM=payable DEFERRABLE INITIALLY DEFERRED constraint trigger, I5 timing trigger, I8 amount_cents > 0 CHECK; enforcement 3 katman (domain authoritative → DB defansif → UI UX); refund/daily-closeout MVP dışı (ayrı ADR). Edit kilit.

**Toplam revizyon turu sayısı:** 5
1. §10.1 ilk tur düzeltmeleri (mixed payment yok, is_comped junction handling, §10.4 forward-ref) + N değişikliği kuralı
2. §10.2 domain kilidi turu (GROSS/NET + T1 auto-propagation) + "Bölüm ??" placeholder temizliği
3. §10.3 terminoloji turu ("taşınabilir POS" → "mobil POS", scratchpad domain notları)
4. §10.4 forward-reference eklentileri + prepaid sadeleştirme + refund sadeleştirme
5. Session kapanış + context-anchor + commit (bu tur)

**Kritik kararlar (ADR-003 Bölüm 10'da kilitli, Session 11'de onaylanan):**
- `orders.total_cents = GROSS` (ikram öncesi toplam); `comped_amount_cents` ayrı kolon; payable = total − comped. NET reddedildi (snapshot stability + rapor tek-kaynak).
- `is_fully_comped=true` → `payments` satır sayısı = **0** (yokluk; sıfır tutarlı tek satır reddedildi — enum anlamsız değer taşımasın).
- T1 auto-propagation: `is_fully_comped=true` geçişinde tüm `order_items.is_comped=true` (DB trigger otoriter).
- `payment_items` junction tam UNIQUE (`order_item_id`), partial değil.
- `equal_split` N değişikliği: mevcut satırlar iptal → Eşit Böl yeniden tetikle (MVP basit akış; manuel N re-calc v5.1).
- Kısmi iptal (`order_items.is_cancelled`) + uncomp + refund + daily-closeout → MVP dışı, ayrı ADR'lere atıf.
- SUM invariant: DEFERRABLE INITIALLY DEFERRED constraint trigger (batch insert pattern).
- `amount_cents > 0` CHECK (sıfır/negatif payment yasak).

**Açık ADR borçları (Session 12+):**
- §10.5 db-migration-guard review gate (Bölüm 10 için zorunlu)
- Bölüm 11 order_no Günlük Unique
- Bölüm 12 Audit Log Şema Kontratı — kritik, db-migration-guard review
- Bölüm 13 Retention & TTL Cleanup
- Bölüm 14 Kritik Index'ler — db-migration-guard review
- Bölüm 15 Migration Stratejisi + tool seçimi
- Bölüm 16 Consequences

**ADR-003 dışı açık borçlar (DoD bekliyor, ADR kabul sonrası):**
- `apps/api/migrations/000_init.sql` şablon migration
- `packages/db` boilerplate
- `packages/db/tests/store-date-parity.test.ts` skeleton
- `pnpm db:types` (kysely-codegen setup)

**Follow-up task'lar (ADR commit sonrası, AYRI PR):**
- `docs/v3-reference/data-model.md` drift (customer_phones tam UNIQUE + hard delete + §6.2/§8.3 atıf)
- v3→v5 takeaway/delivery backfill ADR (Phase 5)
- **YENİ:** Daily-closeout ADR (açık sipariş gün sonu listesi, manuel kapatma akışı; §10.4.2'de forward-reference)
- **YENİ:** Refund ADR (v5.1 veya ihtiyaç çıkarsa; §10.4.6 forward-reference)
- **YENİ:** Kurye tracking ADR (v5.1 delivery genişlemesi; §10.3'te forward-reference)
- **YENİ:** Önceden ödeme / prepaid ADR (v5.1 delivery prepaid akışı; §10.3 + §10.4.4 forward-reference)

**Phase 0 exit kriterleri durumu:**
Phase 0 **açık**. ADR-003 Bölüm 1-10.4 onaylı (13.4/16 eşdeğer). Bölüm 10.5 + 11-16 yazılmadı. ADR-001 + ADR-002 + CI + hello endpoint + monorepo iskeleti yapılmadı.

**Verbatim kontrol durumu (net):**
- Bölüm 1-9 — hepsi verbatim onaylı, Edit kilit
- Bölüm 10.1-10.4 — hepsi verbatim onaylı, Edit kilit (bu session)
- Bölüm 10.5 + 11-16 — yazılmadı

**Sıradaki (Session 12 sırası):**
1. §10.5 db-migration-guard review gate draft — parça parça verbatim sunum → onay
2. Bölüm 11 order_no Günlük Unique
3. Bölüm 12-16 sırayla
4. ADR kabul → 000_init.sql şablon + packages/db boilerplate + parity test skeleton
5. AYRI PR'ler: data-model.md drift + yeni 4 follow-up ADR planlaması (Phase 5'e kaydır)
6. ADR-001 → ADR-002 → CI → hello endpoint (Phase 0 exit)

---

## Session 11 starter prompt — ADR-003 Bölüm 10 başlangıç

```
[TARİH]. Restoran POS v5 Session 11'e başlıyorum.

Önce bağlamı kur:
1. CLAUDE.md — anayasa (Core Directive #7 "cerrahi değişiklik" aktif)
2. docs/context-anchor.md — §2 güncel (Bölüm 9 onaylı, Bölüm 10 sırada)
3. .claude/plans/active-plan.md — Phase 0 AÇIK; ADR-003 Bölüm 10 sıradaki görev; Follow-up'ta iki borç (data-model.md drift + v3→v5 backfill ADR Phase 5)
4. .claude/memory/scratchpad.md — Session 10 kapanış (Bölüm 7-9 onaylı; 4 enum domain kararı kilit)
5. .claude/memory/decisions.md — ADR-003 Bölüm 1-9 onaylı, Bölüm 10'dan devam
6. docs/v3-reference/data-model.md + domain-rules.md + pain-points.md — ödeme ve ikram davranışları için okumaya devam

Session 11 görevi: ADR-003 Bölüm 10 (Ödeme Modeli & İnvaryantları) draft + onay + (zaman kalırsa) Bölüm 11 başlangıç.

Bölüm 10 kapsamı (Session 10'da netleşen enum kararlarına dayalı):
(1) 3 payment_scope davranış tanımı:
    - `full_order`: tek payment satırı, orders.total_cents karşılanır
    - `split_item`: N ayrı payments satırı, item-bazlı ayrıştırma (her satır hangi order_items'ı karşılıyor); "split" payment_type enum değeri DEĞİL (Sinyal #29)
    - `equal_split`: kişi sayısı input → N eşit payments satırı; küsurat kuralı son satır (ör. 841/4 → 3×210 + 1×211); kasiyer override edebilir
(2) İkram enforcement — `orders.is_fully_comped BOOLEAN` + `order_items.is_comped BOOLEAN`:
    - OrderCompService domain layer (app-side authoritative)
    - 3 DB trigger (savunma):
      * is_fully_comped=true → orders.total_cents >= 0 ama payments sum=0 kabul
      * is_comped item → o satır payment'a dahil olmaz
      * is_fully_comped rollback engeli (ikram sonrası ödeme alınamaz, cancel yolu ayrı)
(3) `delivery` ödeme davranışı:
    - Ödeme akışı `takeaway` ile aynı (kurye tracking yok, ödeme zamanlaması değişmez)
    - MVP'de "kapıda ödeme" tek senaryo; "önceden ödeme" v5.1
(4) Invariantlar:
    - SUM(payments.amount_cents) = orders.total_cents (is_fully_comped değilse)
    - payments.order_id + tenant_id match (6.3.1 JOIN enforcement)
    - payment satırının created_at >= orders.created_at

Zorunlu db-migration-guard review (Bölüm 10 için):
- 3 trigger enforcement
- İkram akışı idempotence + rollback semantiği
- split_item tablo ilişkisi (payments → order_items bağı)

Disiplin (Session 9/10 ile aynı):
- Parça parça verbatim sunum, özet yasak
- Her alt madde onaylanmadan Edit YOK
- ADR commit'iyle data-model.md drift + backfill ADR karışmaz (ayrı PR)
- Kapsam kilidi: "kurye tracking v5.1" gibi cazip eklemeleri reddet — v5.0 MVP minimalist

Kod yazma, migration dosyası oluşturma yapma — hâlâ ADR fazındayız. Bağlamı kur, "hazırım" de, sonra Bölüm 10'un §10.1'inden (scope tanımları) verbatim sunumdan başla.
```

## Session 9 kapanış özeti (2026-04-23)

**Tamamlanan — ADR-003 DB Şema İlkeleri (Bölüm 1-9 draft tamam):**

- Bölüm 1 Context — v5 multi-tenant PostgreSQL 17 hedefi, MVP tek tenant, v5.2 RLS commit
- Bölüm 2 Para & Sayısal — yalnız `*_cents INT` (P-06 + Sinyal #21); NUMERIC/DECIMAL/REAL/FLOAT yasak
- Bölüm 3 PK — UUID v7 app-side (`uuidv7` npm), DB DEFAULT yok
- Bölüm 4 Zaman & İş Günü — TIMESTAMPTZ zorunlu, `tenant_settings.business_day_cutoff_hour` singleton pattern + `timezone` IANA, `validate_timezone()` trigger, `set_updated_at()` trigger
- Bölüm 5 store_date() Çift Katman + Parity Test
  - 5.1 IMMUTABLE SQL fonksiyon (parametreli: ts, cutoff_hour, tz)
  - **5.1.1 IMMUTABLE taahhüdü** — AT TIME ZONE text aslında STABLE; IMMUTABLE bilinçli taahhüt. (a) testcontainers imaj pin `postgres:17.2-bookworm`, (b) **ADR-001 explicit contract** — prod imaj pin zorunlu + tzdata auto-update disabled, (c) tzdata update runbook `docs/ops/tzdata-update.md` Phase 5 öncesi
  - **5.1.2 Named parameters zorunlu** — positional çağrı yasak, CI lint
  - 5.2 `orders.store_date` stored kolon + populate trigger (NOT FOUND guard `foreign_key_violation`) + reject_temporal_update trigger; DB otoritatif, app INSERT override imkansız (Kysely `Generated<...>`)
  - 5.3 TS util object-parameter imzası + Temporal polyfill + tip sızdırma yasağı
  - 5.4 tzdata sanity check (8 current offset + **3 historical H1/H2/H3**) fast-fail gate
  - 5.4.a **48 named edge case tablosu** — cutoff triplet × 6 bağlam + Şubat 29 + Gregorian 2100/2400 + Türkiye 2015 DST + **#29 Türkiye 2016 permanent DST abolish** + London BST + NY DST + UTC + mikrosaniye + **#45 Samoa 2011-12-30 skipped day** + Niue + Kathmandu
  - 5.4.b property-based — 2024-2029, 7 tz (Istanbul/UTC/NY/London/Tokyo/Kiritimati/Kathmandu), uniform cutoff, fast-check pseudocode
  - 5.4.c failure mode spec — fast-fail/run-all/shrink üç strateji + `REPLAY_SEED` replay
- Bölüm 6 Multi-Tenant İzolasyon — **onaylandı**, 6.3.1 JOIN enforcement (joinWithTenant + ESLint `no-raw-kysely-join` + db-migration-guard PR gate), 6.4 RLS v5.2 commit
- Bölüm 7 Snapshot — W1 3-seçenek matris (CHECK/trigger/domain), v5.1 trigger ADR notu, N2 CHECK reddi anonimize semantiği
- Bölüm 8 Soft/Hard Delete — B2 customer_phones back-ref 6.2, N3 `customers_active` partial index örneği
- Bölüm 9 Enum — W2 9.5 review gate paragrafı: aynı PR'da ALTER TYPE + DML yasak, **rollback yok forward-only explicit**, out-of-order deploy yasak

**db-migration-guard review (Bölüm 6-9 toplu) bulguları:**
- BLOCKER B1 — Kysely lazy join cross-row leak (repo pattern tek başına yetmez) → 6.3.1 ile kapatıldı
- BLOCKER B2 — customer_phones 6.2 ↔ 8.3 drift → iki yönlü explicit atıf ile kapatıldı
- WARNING W1 — snapshot 3-seçenek matris yok → alan başına enforcement kolonu eklendi
- WARNING W2 — ALTER TYPE review gate eksik → 9.5 eklendi
- NOTE N1/N2/N3 — hepsi işlendi

**Kritik kararlar (ADR-003 içinde kilitli):**
- **IMMUTABLE = bilinçli taahhüt**, ADR-001 prod imaj pin bağı zorunlu
- **RLS v5.2 açılışı öncesi commit'li** — MVP'de kapalı ama tarih taahhüdü var
- **JOIN enforcement gün 1 aktif** — helper + ESLint + PR gate üç katman
- **Forward-only migration**, rollback yok, out-of-order deploy yasak
- **Temporal API + polyfill**, tipleri `packages/db` sınırı dışına sızmaz

**Açık ADR borçları (Bölüm 10-16 — Session 10+):**
- Bölüm 10 Ödeme Modeli & İnvaryantları (ikram enforcement authority + OrderCompService + 3 trigger kural)
- Bölüm 11 order_no Günlük Unique
- Bölüm 12 Audit Log Şema Kontratı — **kritik review gerekli** (PII sanitize `AuditSanitizer<T>`)
- Bölüm 13 Retention & TTL Cleanup
- Bölüm 14 Kritik Index'ler — B2 forward-ref burada kapatılacak
- Bölüm 15 Migration Stratejisi — architect'in matris sonucu + tool seçimi (node-pg-migrate + kysely + kysely-codegen)
- Bölüm 16 Consequences

**ADR-003 dışı çıktılar (DoD bekliyor):**
- `apps/api/migrations/000_init.sql` şablon migration (Bölüm 16 sonrası)
- `packages/db` boilerplate (package.json, tsconfig, scripts)
- `packages/db/tests/store-date-parity.test.ts` skeleton — 48 case + property-based + seed replay
- `pnpm db:types` komutu (kysely-codegen setup)

**Follow-up task (ADR commit sonrası, AYRI PR):**
- `docs/v3-reference/data-model.md` drift düzeltmesi — `customer_phones` satırına "tam UNIQUE; anonimize'de hard delete (ADR-003 §6.2 + §8.3); partial `WHERE deleted_at IS NULL` yasak" notu. `active-plan.md` "Follow-up" bölümünde kayıtlı.

**Verbatim kontrol durumu (net):**
- Bölüm 6 — verbatim sunuldu, **kullanıcı onayı alındı**. Edit'ler kilit.
- Bölüm 7 — Edit uygulandı (W1 + N2), **verbatim kontrol bu session'da YAPILMADI**.
- Bölüm 8 — Edit uygulandı (B2 back-ref + N3), **verbatim kontrol bu session'da YAPILMADI**.
- Bölüm 9 — Edit uygulandı (W2), **verbatim kontrol bu session'da YAPILMADI**.

Bölüm 7/8/9 metni `decisions.md`'de var ama formal onay yok — Session 10'un ilk işi bu üç bölümü sırayla verbatim sunup onay almak.

**Phase 0 exit kriterleri durumu:**
Phase 0 **açık**. `active-plan.md` 8 madde hiçbiri ✅ işaretlenmedi; ADR-003 hâlâ **draft**, Bölüm 10-16 yazılmadı, 000_init.sql + packages/db boilerplate + parity test skeleton + kysely-codegen setup yapılmadı. Kabul yok. Phase 0 exit'ine ADR-003 tamamlanması + ADR-001 + ADR-002 + CI + hello endpoint gerekli.

**Sıradaki (Session 10 sırası):**
1. Bölüm 7 verbatim → onay
2. Bölüm 8 verbatim → onay
3. Bölüm 9 verbatim → onay
4. `data-model.md` drift düzeltmesi (AYRI task, ADR commit sonrası; follow-up `active-plan.md`'de kayıtlı)
5. Parça 4 — Bölüm 10 Ödeme Modeli & İnvaryantları (enforcement authority + OrderCompService framing + 3 trigger kural + payment split-item semantiği)

## Session 10 starter prompt — ADR-003 Bölüm 7-16 devam

```
[TARİH]. Restoran POS v5 Session 10'a başlıyorum.

Önce bağlamı kur:
1. CLAUDE.md — anayasa (v3 referans okuma kuralı, ADR disiplini, kapsam kilidi)
2. .claude/plans/active-plan.md — Phase 0 AÇIK (hiçbir madde ✅ değil); ADR-003 sıradaki görev; "Follow-up" bölümünde data-model.md drift task kayıtlı
3. .claude/memory/scratchpad.md — Sinyaller #1-42 + Session 9 kapanış (ADR-003 Bölüm 1-9 draft + review düzeltmeleri uygulandı; Bölüm 7-9 verbatim kontrol Session 10 ilk işi)
4. .claude/memory/decisions.md — ADR-003 Bölüm 1-9 (Bölüm 6 onaylı; 7-9 Edit uygulandı ama verbatim kontrol bekliyor)
5. docs/v3-reference/data-model.md + domain-rules.md + pain-points.md — okumaya devam

Session 10 görevi: ADR-003 Bölüm 7-9 onayı + Bölüm 10-16 yazımı.

Sıra:
(1) Bölüm 7 verbatim sunum → kullanıcı onayı (tek başına, Bölüm 8'e geçmeden)
(2) Bölüm 8 verbatim sunum → kullanıcı onayı
(3) Bölüm 9 verbatim sunum → kullanıcı onayı
    — Her BLOCKER/WARNING/NOTE tamamlandıkça onay beklenecek; toplu commit yok.
(4) data-model.md drift düzeltmesi (AYRI task, B2 kapsamında) — customer_phones satırına tam UNIQUE + hard delete + ADR-003 atıf notu. ADR commit'iyle karıştırılmayacak.
(5) Parça 4 — Bölüm 10 Ödeme Modeli & İnvaryantları (parça parça; ikram enforcement authority + OrderCompService servis katmanı + 3 trigger kural; split-item payments = N ayrı payments satırı, "split" enum değil)
(6) Bölüm 11 order_no Günlük Unique — `UNIQUE(tenant_id, store_date, order_no)` + günlük reset mekanizması
(7) Bölüm 12 Audit Log Şema Kontratı — kritik, db-migration-guard review zorunlu; PII sanitize `AuditSanitizer<T>` TS interface + event_type taxonomy
(8) Bölüm 13 Retention & TTL Cleanup — audit_logs 2 yıl, call_logs 30 gün, print_jobs başarılı arşiv
(9) Bölüm 14 Kritik Index'ler — B2 forward-ref burada kapatılacak (customer_phones explicit not)
(10) Bölüm 15 Migration Stratejisi + tool seçimi — architect karşılaştırma matris sonucu (4 ek kriter: down strategy, raw SQL vs DSL, drift detection, Turborepo)
(11) Bölüm 16 Consequences — özet, trade-off, takip

DoD bekleyen (ADR kabul sonrası): 000_init.sql + packages/db boilerplate + parity test skeleton + kysely-codegen setup.

Zorunlu db-migration-guard review:
- Bölüm 10 (ikram enforcement 3 trigger)
- Bölüm 12 (audit kontratı — PII sanitize, event_type taxonomy)
- Bölüm 14 (kritik index'ler)
Diğer bölümler risk bazlı değerlendirme — karmaşık trigger / cross-tablo invaryantı / yeni enforcement pattern varsa ek review.

Disiplin:
- Parça parça yazılır, özet yasak — verbatim metin istenecek
- Her BLOCKER/WARNING/NOTE tamamlandıkça kullanıcı onayı zorunlu, toplu commit yok
- ADR commit sonrası AYRI PR'da data-model.md drift düzeltmesi
- "Yaz" onayı gelmeden dosya mutasyonu yok
- Phase 0 exit kriterleri ADR-003 + ADR-001 + ADR-002 + CI + hello endpoint tamamlandığında işaretlenecek

Kod yazma, migration dosyası oluşturma yapma — hâlâ ADR fazındayız. Bağlamı kur, "hazırım" de, sonra Bölüm 7 verbatim sunumdan başla.
```

## Session 7 kapanış özeti (2026-04-22)

**Tamamlanan:**
- Modül 11 — Raporlar (tam dolu, v3 `reports.js` + `periodCloseService.js` koduyla teyit)
- Modül 12 — Rezervasyon (özet düzeyde, v5.1 backlog kararı teyit)
- Modül 13 — Stok (minimal, v5.1 → v5.2+ TERFİ — kapsam küçültme kazancı)
- Modül 14 — Audit Log (tam dolu, backend MVP + v5.1 UI, KVKK netleşme)
- Modül 15 — Yedek/Restore (tam dolu, sıfırdan tasarım — v3'te altyapı yoktu)
- 11 yeni mimari sinyal (toplam 42): #32-40 + #41 yedek vs data retention ayrımı + #42 yedek politikası
- v3 reference ilerleme: %67 → **%100 (15/15) ✅**

**Kapsam terfileri (charter güncelleme zorunlu):**
Charter v5.0 MVP "Raporlar" maddesi genişletildi — 4 yeni kalem MVP'ye girdi (kullanıcı onayı alınmış):
- Saat içi ciro grafiği (hourly heatmap/bar chart)
- Kullanıcı bazında performans raporu
- CSV export (tüm raporlarda `?format=csv`)
- Kategori bazında satış raporu

Bu değişiklikler ayrı commit + ADR-XXX kapsam terfi gerekçesi (Sinyal #30 iskonto ertelemesiyle birlikte aynı charter güncelleme PR'ında toplanabilir).

**Kavramsal netleşme (kritik):**
- **"Z raporu" ismi v5'te kullanılmayacak** — yazarkasa Z ile karışıyor, kullanıcı her gün yazarkasadan manuel alıyor
- POS tarafı = **"günlük kapanış"** (daily_close); otomatik cron tetikleme (işletme kapanış saati + 2 saat)
- Fiş/PDF çıktısı yok, sadece ekran özeti; post-kapanış admin override + audit

**Modül 11'den çıkan diğer kararlar:**
- Hibrit storage: canlı gün SUM + kapanınca `period_closes` satırı
- Ürün rapor snapshot doğru (Sinyal #6 pekişti)
- Kategori snapshot v3'te hazır (`category_id_snapshot` + `category_name_snapshot`) — Sinyal #35
- Ödeme kırılımı satır bazlı (Sinyal #29 pekişti) — mixed enum yok
- Anomali raporu ayrı ekran (iptal + refund + ikram birleşik)
- Açık sipariş uyarısı kapanış öncesi (cron engellenir, admin müdahale bekler)

**Açık ADR borçları:**
- ADR-001 Monorepo (Phase 0)
- ADR-002 Auth (Phase 0)
- ADR-003 DB şema (Phase 0 sonu) ← call_logs TTL + yalnız cents + order_no + print_jobs idempotency + payments idempotency + **period_closes tablosu + order_items.category_id/name_snapshot + orders.created_by + payments.created_by + refunds.approved_by**
- ADR-004 Print Agent (Phase 1 başı)
- **ADR-XXX İskonto MVP→v5.1 + Raporlar kapsam terfi (tek charter update PR)** (Phase 1 başı) ← Sinyal #30 + #32-36
- **ADR-XXX Günlük kapanış cron + post-kapanış admin override akışı** (Phase 1 başı) ← Sinyal #32-33
- **ADR-XXX CSV export protokolü (content negotiation + CP1254/UTF-8 BOM kararı)** (Phase 1) ← Sinyal #36
- ADR-XXX Masa sorumlu garson + masa birleştirme (Phase 1)
- ADR-XXX Müşteri sipariş geçmişi + Excel I/O kapsam terfi (Phase 1 başı)

**Charter güncellemesi bekliyor (üç madde, tek commit):**
1. `docs/project-charter.md` → v5.0 MVP → Ödeme → iskonto satırı v5.1'e (Sinyal #30)
2. `docs/project-charter.md` → v5.0 MVP → Raporlar → 4 kalem ekle (saatlik grafik, kullanıcı performans, CSV, kategori) — Sinyal #32-36
3. `docs/project-charter.md` → v5.1 → Stok satırı KALDIR + v5.2+ bölümüne "Stok takibi (pilotta ihtiyaç doğarsa)" ekle (Sinyal #38). Line 80, 188 silinir.

**Glossary eklenecek:**
- "Z raporu" — POS'ta kullanılmaz, yazarkasa yasal belgesidir
- "Günlük kapanış" — POS gün sonu state kilidi + özet

**Sıradaki:** Modül 14 — Audit Log
- Charter v5.1 backlog: "Audit log UI: filtre, arama, detay sayfası (backend data MVP'de hazır)"
- Yani **backend MVP'de zorunlu** (KVKK + güvenlik + debug için), UI v5.1
- v3 kaynakları: glob `D:\dev\restoran-pos-v3\server\**/*udit*` veya `log.js`
- Modül 2, 10, 11'de audit log bağımlılıkları geçti — bu modül hepsini sentezler

## Session 8 starter prompt — Modül 14 başlangıç

```
[Tarih]. Restoran POS v5 Session 8'e başlıyorum.

Önce bağlamı kur:
1. CLAUDE.md — v3 referans erişimi + KVKK kuralları
2. .claude/plans/active-plan.md — durum (%87, 13/15)
3. .claude/memory/scratchpad.md — sinyaller #1-38 + Session 7 kapanış + 3 charter update borç
4. docs/v3-reference/modules.md — Modül 2 (auth audit), Modül 10 (refund audit), Modül 11 (period_close audit) bağları

Session 8 görevi: Modül 14 — Audit Log röportajı.
- Charter ayrımı: backend MVP (zorunlu), UI v5.1
- v3 kaynakları: glob D:\dev\restoran-pos-v3\server\**/*udit* veya *log*
- Kullanım sorusu kritik: v3'te audit log çalışıyor mu, pilotta yasal/güvenlik ihtiyacı doğdu mu
- MVP olduğu için derin röportaj: event taxonomy, retention, KVKK (müşteri PII maskeleme), actor (user_id + IP + UA), target entity pattern
- AskUserQuestion şıklı format

Kod yazma, dosya oluşturma, commit atma yapma. Önce bağlamı kur, "hazırım" de, onayla Modül 14 A sorusuna geç.

NOT: Charter güncellemesi 3 borç var (iskonto v5.1 + Raporlar 4 kalem + Stok v5.2+) — Phase 1 başında tek ADR-XXX ile birleşik işlenir.
```

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

---

## Session 8 kapanış özeti (2026-04-22)

Bu oturumda tamamlananlar:
- Charter onaylandı (Görev 1 ✅) — commit `72e00c5`
- Phase 3 roadmap ↔ MVP listesi tutarsızlıkları giderildi (iskonto, raporlar terminolojisi)
- "Kapsam değişikliği nasıl belgelenir" paragrafı eklendi (charter): erteleme ≠ mimari ≠ tasarım ADR ayrımı netleşti
- Personas.md terminoloji düzeltmesi (Z raporu → günlük kapanış POS) + yasal Z raporu ile karıştırılmaması için terminoloji notu
- Active-plan.md Görev 1 ✅ işaretlendi, ADR-003 sıradaki görev olarak belirlendi — commit `cdb3deb`
- 2 commit push edildi (`058036f..cdb3deb`)

Phase 0 durum:
- Görev 1 (charter onayı): ✅ `72e00c5`
- Görev 2 (v3 reference 5/5): ✅ `2acab5c`
- Görev 3-8: ⏳ beklemede (ADR-003 sıradaki)

Stratejik kararlar (hatırlatma):
- ADR sırası: **ADR-003 (DB şema) → ADR-001 (Monorepo) → ADR-002 (Auth)**
- Gerekçe: monorepo yapısı migration tool kararına bağımlı, auth DB şemasına bağımlı (ters sıra çalışmaz)
- ADR-004 (Print Agent): Phase 1 başı
- İskonto tasarım ADR'si: v5.1 implementasyonu başında (şimdi yazılmaz)

Açık kararlar (hatırlatma):
- ADR-002 hibrit şifre reset (admin reset MVP, email endpoint ready-but-disabled, v5.1 flag ile açılır)
- ADR-002'de rol matrisi config-driven (front + back aynı kaynak)
- ADR-003'te: UUID v7, TIMESTAMPTZ, tenant_id konvansiyonu, migration tool seçimi (drizzle-kit / kysely / node-pg-migrate)

## Session 12 starter prompt — ADR-003 Bölüm 10.5 + 11 başlangıç

```
[TARİH]. Restoran POS v5 Session 12'ye başlıyorum.

Önce bağlamı kur:
1. CLAUDE.md — anayasa (Core Directive #7 "cerrahi değişiklik" aktif)
2. docs/context-anchor.md — §2 güncel (Bölüm 10.1-10.4 onaylı, Bölüm 10.5 sırada)
3. .claude/plans/active-plan.md — Phase 0 AÇIK; ADR-003 Bölüm 10.5 + 11 sıradaki görev
4. .claude/memory/scratchpad.md — Session 11 kapanış özeti (Bölüm 10.1-10.4 onaylı; 8 domain kararı kilit; 4 yeni follow-up ADR açıldı)
5. .claude/memory/decisions.md — ADR-003 Bölüm 1-10.4 onaylı, Bölüm 10.5'ten devam
6. docs/v3-reference/data-model.md + domain-rules.md + pain-points.md — ödeme ve ikram davranışları için

Session 12 görevi: ADR-003 Bölüm 10.5 (db-migration-guard review gate) draft + onay, ardından Bölüm 11 (order_no Günlük Unique) başlangıç.

Bölüm 10.5 kapsamı:
- Bölüm 10'daki 5 DB trigger (T1 propagate_full_comp, T2 recompute_comped_amount, T3 block_fully_comped_rollback, check_payment_sum DEFERRABLE, check_payment_timing) için db-migration-guard review gate prosedürü
- İdempotence + rollback semantiği doğrulama
- payment_items junction ilişkisi + composite FK (§6.3.1 atıfı) cross-check
- CHECK constraint + DEFERRABLE trigger sınır davranışları
- 0 payments rule DB enforcement (is_fully_comped=true kilidi)

Bölüm 11 kapsamı (10.5 onaylanırsa):
- order_no günlük unique (tenant_id + store_date + order_no) partial UNIQUE index
- sequence vs next_val application-side; race condition davranışı
- v3 v5 geçiş notu (order_no format migration gerekirse)

Disiplin (Session 10/11 ile aynı):
- Parça parça verbatim sunum, özet yasak
- Her alt madde onaylanmadan Edit YOK
- ADR commit'iyle data-model.md drift + 4 yeni follow-up ADR (backfill, daily-closeout, refund, kurye, prepaid) karışmaz (ayrı PR'ler)
- Kapsam kilidi: MVP dışı cazip eklemeleri reddet

Kod yazma, migration dosyası oluşturma yapma — hâlâ ADR fazındayız. Bağlamı kur, "hazırım" de, sonra Bölüm 10.5'in §10.5.1'inden verbatim sunumdan başla.
```

## Session 9 starter prompt — ADR-003 başlangıç

```
[TARİH]. Restoran POS v5 Session 9'a başlıyorum.

Önce bağlamı kur, şu dosyaları sırayla oku:
1. CLAUDE.md — proje anayasası (özellikle "v3 referans erişimi" bölümü)
2. docs/project-charter.md — v5.0 MVP kapsamı, faz roadmap (Phase 0 içindeyiz, ADR'ler sırada)
3. .claude/plans/active-plan.md — Phase 0 görev durumu, ADR-003 sıradaki
4. .claude/memory/scratchpad.md → Session 8 kapanış özeti + stratejik kararlar + açık kararlar bölümleri
5. docs/v3-reference/data-model.md — ADR-003'ün ana girdisi (229 satır, şema iskeleti hazır)
6. docs/v3-reference/pain-points.md — "Kategori: Veri / Şema" bölümü (v3 şema ağrıları, v5'te kaçınılacaklar)
7. docs/v3-reference/domain-rules.md — invaryantlar (snapshot, immutability)

Session 9 görevi: ADR-003 DB Şema İlkeleri
- architect sub-agent + db-migration-guard review
- /new-adr slash command ile başlat
- ADR şu kararları kapsar:
  * Primary key tipi (UUID v7 öneri)
  * Timestamp tipi (TIMESTAMPTZ)
  * tenant_id konvansiyonu (her tabloda, başta tek tenant)
  * Soft vs hard delete stratejisi
  * Audit log tablosu şablonu
  * Migration tool seçimi (drizzle-kit / kysely / node-pg-migrate karşılaştırmalı)
  * Snapshot kolonları invaryantı (domain-rules.md'den)
  * Enum stratejisi (PostgreSQL native vs TEXT + CHECK)
- DoD: ADR decisions.md'de, db-migration-guard onayı, apps/api/migrations/000_init.sql şablon dosyası oluşturuldu

Kod yazma, dosya oluşturma (ADR ve şablon migration dışında) yapma. Önce bağlamı kur, özetle, "hazırım" de, kullanıcı onaylayınca ADR-003 yazımına geç.
```

---

## Session 12 kapanış özeti (2026-04-24)

**Yapıldı:**
- `db-migration-guard` sub-agent ADR-003 Bölüm 10.1-10.4 üzerinde read-only review yaptı; 3 BLOCKER + 7 CONCERN + 8 green-light maddesi çıkardı.
- Üç BLOCKER için kararlar alındı ve ADR-003'e kilitlendi:
  - **B1:** §6'ya yeni alt-bölüm `Kural 6.5 — Composite UNIQUE (id, tenant_id)` eklendi. `users` tablosunun kapsamı ADR-002 kararına bağlı notuyla işaretli.
  - **B2:** Kapalı/iptal siparişte comp DB seviyesinde yasaklandı — yeni `block_comp_on_closed_order` trigger function + iki trigger (orders, order_items). `OLD.order_status` kontrolü (same-transaction closure serbest). `order_items` trigger'ında tenant filtresi (§6.3.1 doktrini).
  - **B3:** `payments_timing_check` clause `BEFORE INSERT OR UPDATE OF created_at` → `BEFORE INSERT`'e daraltıldı. Immutability ayrı `payments_created_at_immutable` trigger'ıyla kilitli (§7 snapshot disiplini payments'a uygulandı).
- **Bölüm 10.5** tam verbatim yazıldı: intro, 10.5.1 BLOCKER kararları + SQL, 10.5.2 CONCERN bucket'ları (A must-fix / B pre-Bölüm 11 pass / C forward-reference), 10.5.3 green-light kilidi, 10.5.4 §10.1-10.4 küçük düzeltmeler özeti, 10.5.5 active-plan follow-up borçları.
- **§10.4.4** trigger clause diff'i uygulandı (B3 tek satır daraltma + açıklayıcı SQL yorumu).
- **§10.2.3** forward-reference paragrafı eklendi (B2 domain izi).
- `docs/context-anchor.md` §2 güncellendi (Session 13 aktif görev + yeni açık borçlar).
- `.claude/plans/active-plan.md` "Sıradaki görev" + "Follow-up" güncellendi (mini-pass + 4 yeni v5.1 ADR borcu).

**Session 13 ilk iş:**
- **Bölüm 11 öncesi mini-pass (CONCERN Bucket A+B):**
  - C1: `BEFORE INSERT ON payment_items` trigger — `order_items.is_comped=true` olan kalemi junction'a eklemeyi DB seviyesinde blokla.
  - C2: `payment_items` UNIQUE konvansiyonu — §6.2 uyumu (ya istisna notu ya `UNIQUE (tenant_id, order_item_id)`).
  - C3: Trigger naming tek forma çek (`<table>_<action>[_<when>]`).
  - C4: `propagate_full_comp` UPDATE'ine `AND tenant_id = NEW.tenant_id` ekle.
  - Ayrı commit, sonra db-migration-guard'a kısa re-review.
- **Ardından Bölüm 11 (order_no günlük unique):** `tenant_id + store_date + order_no` partial UNIQUE index, application-side `next_val` + race condition davranışı, v3→v5 backfill notu.

**Açık stratejik borçlar (§10.5 sonrası yeni eklenenler):**
- v5.1 admin uncomp akışı ADR'si (§10.5 B2 FR)
- Error taxonomy / API error contract ADR'si (§10.5 C6 FR)
- ADR-002 sonrası §6.5 users notu güncellemesi
- v5.1 refund ADR (§10.4.6 + §10.5 C7 pekişti)

**Disiplin notları:**
- v3 kod copy-paste yapılmadı (referans erişim kuralı korundu).
- §10.1-10.4 gövdesine sadece onaylı iki diff uygulandı; başka satıra dokunulmadı.
- Context %60 civarında kapandı, handoff gerekmedi.
- Verbatim yazım disiplinine uyuldu (özet yok, tam metin decisions.md'de).

---

## Session 25 — Phase 1 Exit Audit + Phase 1.5 paketi (oturum 1)

**Tarih:** 2026-04-25
**Çıktı:** Phase 1 Exit Audit (Katman 1 + Forensic Verdict B + Katman 2) → Phase 1.5 paketi (eksik policy + drift cleanup) → oturum 1 İş #1-#5 tamam.

### Audit bulguları

**Katman 1 (Belge & Karar Tutarlılığı):**
- DoD `type:feature` checklist'i Phase 1 backend görevleri için tam uygun değil (UI yok → 5 kalem NA).
- CHANGELOG.md son entry Session 10 (2026-04-24) — Phase 1 (Session 22-25) için entry yok.
- ADR-001 §2.2 drift: `no-restricted-imports` ESLint kuralı yazılmamış.
- ADR-002 §6 drift: `packages/shared-types/src/permissions.ts` yazılmamış.
- Charter Phase 1 driftleri: shared-domain'de Menu/Payment/User policy yazılmamış; "yedek altyapı" yapılmamış.

**Forensic Verdict (charter Menu/Payment/User policy ertelemesi):**
- **Verdict B (ATLAMA)** — bilinçli erteleme değil, sessiz daraltma.
- Kanıt: `1292b7f` commit'i Phase 1 active-plan'ı ilk yazdı. Charter'daki 6 entity (Order/Table/Menu/Payment/Money/User) → brief'te 6 yardımcı dosya (money/order/order-no/table/tax/validation). Menu/Payment/User policy brief'e geçmedi.
- Charter güncellenmedi. CHANGELOG'da entry yok. Scratchpad'de scope reduction notu yok.
- Karar: Seçenek (a) — Phase 1.5'te eksik 3 policy yazılır.

**Katman 2 (Teknik Sağlık):**
- pnpm install temiz, typecheck 8/8, build 8/8, shared-domain test 75/75, coverage Stmts/Branch/Funcs/Lines = 100/96.29/100/100.
- Lint dummy (`echo 'lint: ok'`) — gerçek ESLint koşmuyor.
- 000_init.sql migration sıfırdan idempotent değil: `CREATE ROLE` cluster-level çakışma → yeni DB'de migrate patladı.
- Branch protection main yok (GitHub Free + private). Pro upgrade Phase 2 öncesi yapılacak.

### Phase 1.5 oturum 1 commit'leri (local, push oturum 2 sonu)

| # | İş | Commit |
|---|---|---|
| 1 | `permissions.ts` (ADR-002 §6 role permission matrix, 20 action × 4 role = 82 test) | `bc9cba1` |
| 2 | ESLint no-restricted-imports + gerçek lint scriptleri (ADR-001 §2.2) | `040521f` |
| 2.5 | Yan ürün: ölü `eslint-disable` directives temizliği (3 yorum) | `3c5458b` |
| 3 | Migration `CREATE ROLE` idempotency (4 ayrı DO/EXCEPTION blok) | `3eb8481` |
| 4 | `menu.ts` Menu policy + tests (1 fonksiyon: `canHardDeleteProduct`, 5 test) | `bf33fc5` |
| 5 | `payment.ts` Payment policy + tests (4 fonksiyon, 20 test, total 100 test) | `c27de1a` |

Coverage Phase 1.5 sonu (oturum 1): All files 100/97.29/100/100.

### Disiplin notları (oturum 1)

- **Brief dışı karar disiplini ihlali (3 nokta erken oturumda):** linterOptions ekleme, "yeşilse commit" warning yorumu, commit ihlali (warning'lerle commit). Standart madde brief'lere eklendi: "brief dışı karar gerekirse → dur, sor, onay sonrası devam" + "yeşil = error 0 + warning 0 + test pass."
- **Verbatim sunum disiplini:** her iş öncesi tam dosya içeriği kullanıcıya gösterildi, onay sonrası commit.
- **Cerrahi değişiklik:** her commit tek amaçlı; ölü disable cleanup ayrı commit (ESLint enforce'tan ayrıldı, atomic).
- **Forensic disiplin:** "atlama mı bilinçli mi?" sorusu repo kanıtıyla yanıtlandı (active-plan tarihçesi, charter history, scratchpad arama, CHANGELOG history).

---

## Oturum 2 starter prompt (Session 26)

```
Phase 1.5 oturum 2 — devam.

Bağlam: docs/context-anchor.md §2 + .claude/plans/active-plan.md
"Phase 1.5" bölümü oku. Oturum 1 (Session 25) İş #1-#5 tamam (commit
hash'leri context-anchor'da). Oturum 1 commit'leri local'de, henüz
push edilmedi (Phase 1.5 paket sonu toplu push).

Sıradaki işler (sırayla, her birinde verbatim sunum + onay → commit):

  İş #7 (önce, User policy ÖNCESİ): domain-rules.md + ADR-003 §10
    drift cleanup
    - domain-rules.md sat 41 enum isimleri güncel ({full, item,
      partial} + {cash, card, transfer})
    - ADR-003 §10 prose metni RENAME öncesi enum isimleri içeriyor —
      güncelle (full_order→full, split_item→item, equal_split→partial)
    - ADR-003 §10.2.3 dosya yolu drift: shared-domain/src/orderComp.ts
      → apps/api/src/services/orderComp.ts (Phase 2'de yazılacak)
    - Tek text-replace pass'i, doğrudan Edit (sub-agent değil), ~30 dk
    - Commit: docs(drift): align domain-rules and ADR-003 §10 with
      current enum names + service location

  İş #6: user.ts User policy + tests
    - shared-domain pure pattern (menu.ts/payment.ts gibi)
    - "Why this scope?" doc string
    - domain-rules.md kanıtları + ADR-002 §1 §6 §8
    - Brief sıkı: dosya + fonksiyon listesi + ADR/domain-rules
      referansları + eksikler açık not

  İş #8: CHANGELOG.md
    - Session 11-25 (Phase 1 Görev 9-13 + ADR-004 + Phase 1.5)
    - [Unreleased] altında entries
    - Format: Keep a Changelog v1.1.0

  İş #9: Charter + context-anchor netleştirmeleri
    - Charter Phase 1 satırı: "yedek altyapı" yorumu netleştir
      (Phase 1: DB seviyesi audit log + soft delete + migration
      sistemi; cron-driven PITR Phase 4'te)
    - context-anchor §2 hibrit şifre reset notu
    - Phase 1.5 forensic reconciliation notu
    - Phase 2 öncesi GitHub Pro + branch protection notu

  İş #11: Phase 1.5 paketi toplu push (git push origin main)
    - 6 oturum 1 commit + oturum 2 commit'leri
    - git log --oneline -10 + status göster

Hatırlatmalar:
- ADR önce, kod sonra (zaten Phase 1.5 ADR-001/002/003/004 ile çalışıyor)
- DoD olmadan iş kapanmaz
- Kapsam kilidi: brief dışı karar gerekirse → dur, sor, onay
- "Yeşil" = error 0 + warning 0 + test pass
- Verbatim sunum her işte zorunlu
- Push İş #11 sonrası

Başla: önce git log --oneline origin/main..HEAD ile oturum 1
commit'lerini doğrula. Sonra İş #7 brief'i hazırla, kullanıcıya sun.
```
