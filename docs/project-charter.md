# Proje Anayasası — Restoran POS v5

> Bu dosya projenin **neden** var olduğunu, **ne** olduğunu ve **ne olmadığını** anlatır. Her önemli kararda buraya geri dönülür. Değişiklik ancak açıkça gerekçelendirilmiş bir ADR ile mümkündür.

## Neden var?

İlhan'ın kendi restoranı (25 masalı pide/lokanta + paket servisli) hâlâ v3 POS'unu kullanıyor. v3 çalışıyor, olgun, tüm modüller yerinde — ama:
- Mimari karışık (claude.ai + cursor + codex + claude code multi-araç geliştirmesi)
- Online değil, sadece tek PC'de lokal çalışıyor
- Garson için mobil uygulama yok (garson koşarak kasaya gelip sözlü sipariş veriyor)
- Yazıcı sistemi sorunlu (3 yazıcıda Türkçe karakter bozuk, fiş düzeni bozuk, sürüm güncellemesinde yazıcı akışı bozuluyor)

v5 bunları çözecek: **v3 kapsamını koruyacak + v4'ün geliştirme disiplinini uygulayacak + cloud backend + iOS/Android mobil + düzgün yazıcı katmanı**.

v4 neden değiştirildi: v4 kapsamı 5-20 şubeli SaaS olarak büyüdü, solo dev için 9-12 ay çıktı. Hiç kod yazılmadan iptal edildi. **v4'ten iskelet disiplini** (sub-agent'lar, skill'ler, ADR akışı, Definition of Done) v5'e taşındı; **v4'ün geniş ürün kapsamı** terk edildi, yerine **v3'ün kapsamı** geldi.

## Ne yapıyoruz? (vizyon — tek paragraf)

v3'ün her şeyini yeniden ama **temiz** yazmak: kasiyer web tarayıcıdan, garson mobil uygulamadan, mutfak büyük ekran tarayıcıdan erişir; yazıcılar cloud'dan print job çeken Print Agent üzerinden Türkçe karakterlerle bozulmadan basar; veritabanı Hetzner Almanya'da, tüm işletmenin bir kopyası cloud'da. Sistem offline kısıtlı çalışır ama asıl yaşam alanı cloud. 5-6 ay içinde kendi restoranımda paralel pilot'a girmeli, 7-8 ay sonunda v3 yerine tamamen geçilmeli.

## Hedef pazar / kullanıcı

- **Birincil**: Kendi restoranım (pide/lokanta tarzı, 25 masa, paket servis, 2-4 garson, kasiyer, mutfak)
- **İkincil (gelecek)**: Tanıdık çevresinden 2-3 küçük/orta işletme (kafe veya benzer profil)
- **Hedef değil**: 5+ şubeli zincirler, franchise yapılar, bar/nightlife, kurumsal müşteriler

## Özellik kapsamı — net MVP/v5.1 ayrımı

Karar kriteri: **günlük operasyonel kritiklik + kullanım sıklığı + mimari bağımlılık**.

### v5.0 — MVP (pilot için zorunlu, 5.5 ayda teslim)

**Auth ve kullanıcı:**
- Login (email + şifre + JWT access/refresh)
- Roller: admin, kasiyer, garson, mutfak (role matrix `docs/domain/personas.md`)
- Demo hızlı giriş (dev/staging için, prod'da kapatılabilir)
- Kullanıcı yönetimi (admin ekler, rol verir, şifre sıfırlar)

**Operasyonel:**
- Masa yönetimi (25+ masa, salon bölgeleri — İç Salon, Dış Salon vs. eklenebilir)
- Menü editörü (kategori + ürün + özellik grupları/varyasyonlar, fiyat, stok durumu bağlantısı)
- Sipariş yönetimi (dine-in + paket servis)
  - Masa açma/kapama, masa taşıma, masa birleştirme
  - Sipariş kalemleri (adet, not, varyasyon seçimi)
  - Sipariş mutfağa gönder (print + KDS event)
- Mutfak ekranı (realtime Socket.IO, yeni sipariş sesli uyarı, kalem bazlı "hazır" işaretleme)
- Ödeme
  - Parçalı ödeme (nakit + kart karışık, birden fazla müşteri ayrı; kalem bazlı allocation)
  - İkram (kalem bazlı `is_comped` + `comp_reason`)
  - İptal (ödeme öncesi = sipariş cancel; sonrası = refund, admin onay + neden zorunlu, audit log)
  - **Not:** İskonto (sipariş bazlı, kasiyer limit altı / admin üstü) **v5.1'e ertelendi** — Modül 10 röportaj kararı, sinyal #30, commit `a6d746e` charter değişikliğiyle belgelendi. v3'te DB alanı mevcut ama route/UI yoktu, fiilen kullanılmıyordu. Erteleme kapsam kararı olduğu için ayrı ADR gerektirmez; iskonto **tasarım ADR'si** (limit eşikleri, admin override akışı, audit log entegrasyonu) v5.1 implementasyonu başlarken yazılır.
- Paket servis + Caller ID (telefon geldi → popup → müşteri eşle/kaydet → sipariş aç)

**Yazıcı:**
- Print Agent (restoran PC'sinde Windows servisi, cloud'dan print job çeker)
- ESC/POS protokolü, CP857 Türkçe karakter desteği
- 3 yazıcı routing: adisyon (kasa), mutfak, bar (kategori bazlı yönlendirme)
- Yazıcı durumu monitoring (bağlı, offline, kağıt yok)

**Raporlar (temel) — Modül 11 röportaj kapsamı (sinyal #32-36):**
- **Günlük kapanış** (gün sonu kapanış — POS tarafı; yazarkasa Z raporu POS kapsamı dışı, fiziksel yazarkasadan alınır — sinyal #32)
- **X raporu** (dönem içi ara bakış, serbest tarih+saat aralığı)
- **Ürün satış raporu** (tarih aralığı, `GROUP BY product_name` snapshot — sinyal #6)
- **Kategori bazında satış raporu** (kategori toplam + alt ürünler — MVP'ye terfi)
- **Günlük ciro + saatlik ciro grafiği** (hourly bar chart — MVP'ye terfi)
- **Ödeme kırılımı** (nakit/kart; mixed yok — sinyal #29)
- **Masa/paket dağılımı** (dine-in / takeaway)
- **Anomali raporu** (iptal + refund + ikram tek ekran — denetim için)
- **Kullanıcı bazında performans raporu** (user_id → sipariş sayısı + ciro — MVP'ye terfi; pilotta tek kullanıcı pratik etki düşük ama altyapı Phase 2 mobil garson için hazır)
- **CSV export** (tüm rapor ekranlarında `?format=csv` generic middleware — MVP'ye terfi, sinyal #36)

**Altyapı — backend'de var, UI v5.1'de:**
- Denetim günlüğü (audit log) — tüm kritik aksiyonlar DB'ye yazılır (kim, ne, ne zaman, eski/yeni değer), sorgulanabilir UI v5.1
- Otomatik DB yedekleme (günlük cron, cloud storage — Hetzner Storage Box veya S3-compatible), restore şimdilik manuel (SQL dump)

**UI katmanları:**
- Web UI: kasiyer ekranı, mutfak ekranı, admin paneli (kullanıcı, menü, ayarlar, raporlar)
- Mobil (iOS + Android): sadece garson rolü — sipariş girişi, masa takibi, adisyon görüntüleme
- İşletme bilgileri ayarları (ad, adres, vergi bilgisi, fiş başlığı, logo)

### v5.1 — İlk büyütme (pilot stabilize olduktan sonra, ~2-3 ay ek iş)

- **Detaylı raporlar (ileri)**: 7 gün / 30 gün ciro trendi, vardiya raporu, bahşiş raporu, iskonto raporu (iskonto v5.1'e geldiğinde), ay-ay karşılaştırma. Temel raporlar (kategori, saatlik, kullanıcı, CSV) MVP'ye terfi edildi — sinyal #32-36.
- **Rezervasyon modülü**: takvim, masa ataması, müşteri eşleştirme, otomatik hatırlatma SMS (opsiyonel)
- **Müşteri CRM**: detaylı müşteri kartı, Excel import/export, sipariş geçmişi görüntüleme
- **İskonto**: sipariş bazlı iskonto (kasiyer limit altı %X, üstü admin onayı) — MVP'den ertelendi (Modül 10 sinyal #30, commit `a6d746e`). v5.1 implementasyonu başında tasarım ADR'si yazılır.
- **Audit log UI**: filtre, arama, detay sayfası (backend data MVP'de hazır)
- **Yedek/restore UI**: yedek listesi, tek tıkla restore, yedek indirme
- **Sürüm notları UI**: changelog'un kullanıcıya gösterilmesi
- **Mobil cihaz eşleştirme UI**: garson telefonları kayıt, device fingerprint, eşleştirme yönetimi
- **Raporlar Excel/PDF export**
- **İşletme ayarları — genişletilmiş alanlar**: fiş header text, telefon, vergi no, restoran adı PATCH'i. v5.0 Sprint 6 (Görev 24) kapsam kararı (Session 40, 2026-04-29): MVP'de yalnız `tenant_settings` mevcut kolonları (`timezone`, `business_day_cutoff_hour`) GET/PATCH edilir; ek alanlar v5.1'e ertelendi. Gerekçe: fiş baskısı Print Agent ile (Phase 4+) gelir; bu alanlar olmadan MVP kritik yolu çalışır. v5.1'de migration 008 + UI ile açılır.

### v5.2+ (ileri ufuk — ADR olmadan başlanmaz)

- **Çoklu şube yönetimi** (asıl büyük iş: tenant-per-branch model, cross-branch raporlar)
- **Çoklu tenant** (başka işletmelere satılabilir hale getirme)
- **Offline mod** (browser-side IndexedDB cache, offline queue, sync)
- **Stok takibi** (pilotta ihtiyaç doğarsa) — v5.1'den v5.2+'ya terfi (sinyal #38). Gerekçe: pilot restoranda stok takibi pratikte kullanılmıyor (manuel sayim), v3 kodu ölü. İhtiyaç doğarsa ADR ile açılır.

### Kalıcı olmayacaklar (project non-goals)

- **e-Fatura / e-Arşiv** — yasal + ciddi mühendislik işi, bizim ölçeğimizde gereksiz
- **Yazarkasa / ÖKC entegrasyonu** — yasal zorunluluk ama bizim restoranımız için adisyo yeterli
- **Yemeksepeti / Getir / Trendyol Yemek** — partner başvurusu + API lisansı gerektirir, solo dev için tükenme kapısı
- **QR menü** — farklı ürün kategorisi, ayrı proje
- **Sadakat programı / puan** — nice-to-have, core değil
- **Combo menü / reçete yönetimi** — restaurant type'ımız için gerekmiyor

## Kapsam kilidi kuralı

Bu listede **olmayan** hiçbir şey v5.0'da yapılmaz. İstenirse yeni ADR + gerekçe + v5.1 backlog'a ekleme. Yeni özellik teklifi geldiğinde sorulacak 3 soru:
1. v3'te var mıydı?
2. v5.0 MVP listesinde mi?
3. Yoksa neden şimdi? (ADR ile cevapla)

Sessiz kapsam büyümesi = Definition of Done ihlali.

**Kapsam değişikliği nasıl belgelenir:** Mimari değişiklik gerektiren kapsam kararları yeni ADR ile açılır. **Erteleme / terfi** gibi saf kapsam kararları (ör: iskonto MVP → v5.1, stok v5.1 → v5.2+) ayrı ADR gerektirmez; charter'ın kendi değişiklik commit mesajında ilgili sinyal referansıyla belgelenir (ör: `a6d746e` sinyal #30 iskonto ertelemesi). Uygulama mimarisi zamanı geldiğinde ayrı tasarım ADR'si yazılır.

## Başarı kriterleri

**Teknik:**
- v5 2 hafta paralel çalıştıktan sonra kendi restoranımda v3 tamamen kaldırıldı, geri dönmeye ihtiyaç duymadım
- Yazıcı fişleri her baskıda Türkçe karakterler dahil doğru basıldı (v3'teki en büyük ağrı çözüldü)
- Sürüm güncellemesi yazıcı akışını bozmadı (Print Agent ayrı versiyonlanıyor, web/mobil ayrı)

**Performans:**
- Web UI p95 etkileşim < 200ms (yoğun saat dahil)
- Mobil sipariş girişi → mutfağa iletim < 2 saniye
- Günlük 8 saat yoğun kullanımda çökme/donma yok

**Kullanılabilirlik:**
- En az 2 garson aynı anda kesintisiz sipariş girebiliyor
- Yoğun saatte (öğle rush, akşam servisi) sipariş girişi < 45 saniye (3-4 kalem)
- Kasiyer parçalı ödeme < 1 dakika

## Stack ve mimari (özet)

Detay `CLAUDE.md`'de. Özet:
- Backend: Node.js + Express + TypeScript + PostgreSQL (Hetzner Almanya)
- Web: React + Vite + TypeScript + Tailwind
- Mobil: React Native + Expo (Dev Client)
- Print Agent: Node.js Windows servisi (v3'teki StoreBridge'in yerini alır, düzgün yazıcı katmanı)
- Monorepo: pnpm + Turborepo

**Kritik mimari tercih**: "Multi-tenant ready, single-tenant starting." DB'de her tabloda `tenant_id` kolonu var ama başlangıçta tek tenant (ID: 1). v5.2'de çoklu tenant açılır, kod değişmez — sadece policy ve UI çoklu tenant destekler.

## Faz roadmap

### Phase 0: Bootstrap & Foundation (2 hafta)
Monorepo, ilk 3 ADR (monorepo yapısı, auth, DB şema ilkeleri), CI, Hetzner hazırlık, hello endpoint, v3 reference notları.

### Phase 1: Core Domain + Auth + DB Schema (4 hafta)
- `packages/shared-domain` — Order, Table, Menu, Payment, Money, User entity ve policy'leri (TDD, %85 coverage)
- `packages/shared-types` — zod şemaları
- Auth sistem (JWT access + refresh, role matrix)
- DB şema (tüm tablolar, migration'lar, audit log tablosu, soft delete kolonları); cron-driven PITR backup Phase 4'te
- Repository pattern

### Phase 2: API + Temel Web UI (5 hafta)
- REST endpoint'ler (auth, users, menu, tables, categories, products/variants)
- Socket.IO realtime altyapısı
- Web UI — login, ana sayfa, masa yönetimi, menü editörü, kullanıcı yönetimi, salon bölgeleri, işletme ayarları
- E2E test (Playwright) smoke suite

### Phase 3: Sipariş + Mutfak + Ödeme + Yazıcı + Raporlar (5 hafta)
- Sipariş akışı (oluştur, mutfağa gönder, ödeme, kapat)
- Mutfak ekranı (realtime)
- Ödeme (parçalı, ikram, iptal/refund — iskonto v5.1'e ertelendi, sinyal #30)
- Print Agent (Windows servisi) + ESC/POS + 3 yazıcı routing + CP857 Türkçe
- Temel raporlar (günlük kapanış, X, ürün satış, kategori, saatlik ciro, ödeme kırılımı, masa/paket, anomali, kullanıcı performans, CSV export) — MVP kapsam listesiyle tam uyumlu

### Phase 4: Mobile + Caller ID + Audit + Yedek (4 hafta)
- Garson mobil uygulaması (sipariş girişi, masa takibi, adisyon görüntüleme)
- Caller ID bridge (v3 çözümü taşınır — PowerShell forward → cloud endpoint)
- Audit log backend (DB'ye yazılır, UI v5.1'de)
- Otomatik DB yedek (Hetzner Storage Box veya S3-compatible cron)

### Phase 5: Pilot + Migration + Stabilizasyon (3 hafta)
- v3 veri migration scripti (SQLite → PostgreSQL dump + transform)
- Kendi restoranımda 2 hafta paralel çalıştırma (v3 ana, v5 yedek)
- Hata toplama, stabilizasyon
- Sonra: v3 yedekte, v5 ana
- Personel eğitimi (özellikle garson mobil app)

**Toplam: 23 hafta (5.5 ay)** — agresif ama gerçekçi.

## v5.1 phase roadmap (pilot sonrası, ~2-3 ay)

Ayrı planlamak yerine pilot sonrası MVP değerlendirmesi + prioritization yapılır. Muhtemel sıralama:
1. Detaylı raporlar (ileri — 7/30 gün trend, vardiya, bahşiş; temel raporlar MVP'de)
2. Audit log UI (güvenlik + hata ayıklama için)
3. Müşteri CRM + detaylı kart
4. Yedek/restore UI
5. Rezervasyon
6. İskonto (MVP'den ertelenen, ADR-XXX gerekçeli)
7. Sürüm notları UI, mobil cihaz eşleştirme UI

_Not: Stok takibi v5.1'den v5.2+'ya terfi edildi (sinyal #38)._

## Risk listesi ve azaltımlar

| Risk | Olasılık | Etki | Azaltım |
|---|---|---|---|
| Yazıcı sorunu tekrar eder | Orta | Yüksek | `escpos-printer` skill'i detaylı hazır, Print Agent ayrı test edilir, her güncellemede 3 yazıcı smoke test |
| Cloud kesintisinde restoran durur | Düşük | Yüksek | v5.1 backlog'da offline mod; MVP'de temel site-to-site VPN veya manuel rollback planı |
| Kapsam şişmesi (yine) | Yüksek | Yüksek | Kapsam kilidi, v5.0 MVP listesi dondurulmuş, "v3'te var mıydı?" sorusu kapıda bekler |
| Solo dev tükenme | Orta | Yüksek | Haftalık DoD, phase bazlı ilerleme, v5.1'e ertelenen modüller baskıyı azaltıyor |
| Migration (v3 → v5) başarısız | Orta | Yüksek | Phase 5 başında migration scripti yazılır, test DB'de prova, 2 hafta paralel |
| Mobil uygulama store onayı gecikir (Apple özellikle) | Orta | Orta | TestFlight / Firebase Distribution ile development boyunca test; Phase 4 sonunda app store başvurusu |
| v3'te çalışan bir özelliği v5'te "unutmak" | Orta | Orta | `docs/v3-reference/` klasörü Phase 0'da doldurulur, her feature checkpointed |

## Bu doküman nasıl güncellenir?

- **Küçük düzeltme** (yazım, netleştirme): direkt commit, `docs(charter): ...`
- **Kapsam değişikliği** (v5.1'den MVP'ye terfi veya tersi): yeni ADR + charter güncellemesi, PR'da gerekçe
- **Non-goal'dan goal'a geçiş**: zorlu; `architect` + `security-reviewer` review zorunlu, İlhan açık onay
