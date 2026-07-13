# Blok 9 — apps/web (React): derin denetim

> Derin denetim serisi Blok 9. **Tarih:** 2026-07-12 · **Branch:** `audit/09-web` (base `a40b28a`) · **Model:** Fable 5.
> **Yöntem:** 5 paralel hat (A: qa-engineer — BUG/ROB/PERF/DEAD · B: security-reviewer · C: i18n-key-checker · D: hci-reviewer · E: turkish-ux-reviewer) + ana-context CANLI tarayıcı doğrulaması (preview_* + in-page JS enstrümantasyon) + severity kalibrasyonu.
> **Canlı ortam:** lokal `pos_test` (head 044, seed: 1 admin + 6 masa + 5 ürün + 2 müşteri + tenant_settings) + API `tsx watch` (3001) + Vite dev (5173). Prod/pos_dev'e DOKUNULMADI. Prod kod DEĞİŞTİRİLMEDİ.
> **Testler:** `apps/web/audit/` altında 2 yeni dosya (node:test, bağımsız koşucu): **8 kasıtlı KIRMIZI (findings) + 7 yeşil (audit sınır)**. Koş: `node --test apps/web/audit/`.
> **Ham bulgu:** A:7 · B:8 · C:5 grup (38 site) · D:15 · E:7 → konsolide **24 bulgu: 0 BLOCKER · 4 HIGH · 12 MEDIUM · 8 LOW.**

---

## 0. Yönetici özeti

**Web çekirdeği mimari olarak sağlam — XSS/token/env üçlüsü temiz, mutation-shape disiplini 15 API dosyasında tutarlı, hata-toast hattı canlıda çalışıyor. Dört gerçek HIGH: hata-durumu boş-durum maskesi, no-op Yazdır butonu, sistemik i18n ihlali (para-yolu), büyük-tutar onayı eksiği.**

**✅ Güçlü çıkanlar (canlı+kod doğrulandı):**
- **XSS TEMİZ** — `dangerouslySetInnerHTML`/`innerHTML` sıfır kullanım; tüm kullanıcı verisi React text-node; `href` yalnız statik `tel:`.
- **Token saklama GÜÇLÜ** — access token in-memory Zustand (persist YOK, `localStorage` sıfır); refresh httpOnly cookie. **401→refresh→retry zinciri CANLI YAKALANDI** (customers/search 401 → tek uçuş refresh → 200; single-flight çalışıyor).
- **Mutation yanıt-şekli** — 15 api.ts dosyası apps/api route'larıyla tek tek çapraz-doğrulandı: `{data:...}` konvansiyonu tutarlı; TEK istisna dormant (aşağıda W9-A-01).
- **Kaydet hata geri-bildirimi ÇALIŞIYOR** — API kesintisinde canlı ölçüm: "Sipariş kaydedilemedi" toast'ı tıklama+111ms'de render, 4,3 sn görünür; pending kalemler "Kaydedilmedi" rozetiyle KALICI duruyor (veri kaybolmuyor). (İlk gözlemde "sessiz hata" sanıldı — §4 metodoloji notu.)
- `any` tipi **0** · Zustand selector'ları atomik · response-PII (Blok 2/4/6 devri) **web'de RENDER EDİLMİYOR** · KDS bağlantı-banner'ı + 64px hedefler + per-item pending örnek-doğru · void/iptal 2-adımlı onay + enum sebep.

**🟠 4 HIGH:**
1. **W9-A-03** — 4 ekranda `isError` hiç ele alınmıyor; **Müşteriler hata durumunda "Henüz müşteri yok / İlk müşteriyi ekle" basıyor** (CANLI: DB'de 2 müşteri varken API kesildi → yanlış boş-durum; API dönünce de yapışkan kalıyor). Prod'da 1469 müşteri → kasiyer mükerrer kayıt açar. Masalar panosu aynı durumda sessiz-boş.
2. **W9-HCI-01** — Sipariş ekranı header "Yazdır" butonu `() => undefined` no-op (CANLI: tık → 0 istek, 0 toast, 0 değişim). Aynı aksiyon Masalar panosunda çalışıyor → tutarsız + rush-hour'da "cihaz dondu" algısı.
3. **W9-I18N-01** — 38 doğrulanmış hardcoded string sitesi / 13 dosya (CLAUDE.md çekirdek direktif 4 ihlali). Yoğunluk para-yolunda: **SplitPaymentModal 13 site** (chip task_20f0e0c9 teyit; 5'inin key'i `tr.json`'da TANIMLI ama ÇAĞRILMIYOR) + orders bileşenlerinde 12 `aria-label`.
4. **W9-HCI-02** — Hızlı Öde'de >1000 TL onay modalı yok (checklist satır 40 açık gereksinim); yöntem dokunuşu anında tam tahsilat (CANLI: Nakit → anında 201). ADR-033 void-recovery mevcut → BLOCKER değil.

**Kalibrasyon (ana-context düzeltmeleri):** D'nin W9-HCI-03'ü (çıkışta sepet kaybı) bulgu DEĞİL — S84 kullanıcı-talebi + ADR-013 "pending local" bilinçli karar (kod yorumunda belgeli); kalan iş yalnız `docs/hci/exceptions.md` resmî kaydı (dosya YOK). A'nın W9-A-02'si HIGH→MEDIUM (aynı ADR gerekçesi; eksik olan route-level boundary). D'nin "AdisyonPanel +/− arası 2px" iddiası CANLI ölçümde YANLIŞ (32px, arada adet etiketi) — boyut bulgusu (40×40<52) geçerli. E'nin "JSX'te hardcoded TR = 0" bulgusu C ile ÇELİŞİYOR — C'nin 38-site envanteri geçerli (E yalnız düz text-node taramış). E'nin W9-TR-002 önerisindeki "Toplam Siparış" yazımı kendisi hatalı → doğrusu "Toplam Sipariş".

### En kritik 3
1. **W9-A-03** (HIGH) — hata ≠ boş-durum: 4 ekrana `isError` dalı + retry butonu. Tek desen, Blok 13'te 1 PR.
2. **W9-HCI-01** (HIGH) — Yazdır'ı TablesListPage'deki `printBill` akışına bağla veya butonu kaldır.
3. **W9-I18N-01** (HIGH) — SplitPaymentModal: 5 site mevcut key'e bağlanır (bedava), 8'e yeni key; orders aria-label'ları ortak `order.a11y.*` setine.

---

## 1. Kapsam & yöntem
**Denetlenen:** `apps/web/src/**` (137 dosya) — features/{auth,dashboard,orders,payment,reports,customers,kds,caller-id,tables,admin/*}, components/**, store/{auth,sidebar}, lib/*, i18n (tr.json 1293 satır), App/router/main. Çapraz: apps/api route yanıt şekilleri, packages/db+api errors.ts (PII devri), vite.config, index.html.
**Canlı:** login → masa → sipariş → Kaydet → Hızlı Öde/Nakit → müşteri atama → split modal uçtan uca `pos_test`'te; API-kesinti senaryoları (kill+restart); dokunma hedefleri `getBoundingClientRect` ile ölçüldü; toast davranışı in-page tek-zaman-çizelgeli enstrümantasyonla kanıtlandı.

## 2. Bulgular

### 2.1 HIGH (4)

### [HIGH] [ROB] Hata durumu yanlış boş-durum olarak sunuluyor — 4 ekran `isError`'suz (ID: W9-A-03) — CANLI TEYİT
- **Dosya:** `apps/web/src/features/customers/CustomersPage.tsx:260-265` · `tables/TablesListPage.tsx:327-344` · `admin/DiningAreasPage.tsx:176-194` · `admin/MenuDefinitionsPage.tsx:227-251`
- **Kanıt (canlı):** API kapatıldı → Müşteriler: **"Henüz müşteri yok / İlk müşteriyi ekle"** (DB'de 2 kayıt); Masalar: alan başlığı + stale "5 Boş 1 Dolu" duruyor, grid TAMAMEN boş — hata mesajı/retry YOK. API geri geldikten sonra da hatalı sonuç **yapışkan** (retry:false + manuel refetch gerekiyor).
- **Etki:** Prod 1469 müşteri: geçici API kesintisinde kasiyer "müşteri yok" görür → mükerrer müşteri açar (veri kirliliği) veya paniğe kapılır. · **Öneri:** 4 ekrana `isError` dalı (hata metni + "Tekrar dene"); boş-durum yalnız `isSuccess && data.length===0`. · **Etiket:** MVP-fix

### [HIGH] [BUG/HCI] Sipariş ekranı "Yazdır" sessiz no-op (ID: W9-HCI-01) — CANLI TEYİT
- **Dosya:** `apps/web/src/features/orders/OrderScreenPage.tsx:292` (`const handlePrint = () => undefined;`) → `components/OrderScreenHeader.tsx:130-140`
- **Kanıt (canlı):** Persisted siparişte header yazıcı ikonu aktif görünümlü; tık → **0 network isteği, 0 toast, 0 durum değişimi**. Karşıt örnek: `tables/TablesListPage.tsx:439-451` aynı aksiyonu `toast.promise(printBill.mutateAsync)` ile doğru yapıyor.
- **Etki:** Rush-hour'da tekrar-tekrar basma / "sistem dondu" algısı; Nielsen #1 (görünürlük) para-yolu ekranında. · **Öneri:** printBill akışına bağla ya da butonu kaldır/disabled+tooltip. · **Etiket:** MVP-fix

### [HIGH] [i18n] 38 hardcoded kullanıcı-metni sitesi / 13 dosya — para-yolu yoğun (ID: W9-I18N-01)
- **Dosya (öbek):** `payment/components/SplitPaymentModal.tsx` **13 site** (91, 739, 761, 798, 805, 993, 1021, 1069, 1109, 1135, 1163, 1166, 1190 — canlıda görüldü: "Kişi 1", "Soldan ürün ekleyin", "Nakit", "Kredi Kartı", "Bu kişiden ödemeyi al", "Kalan 1") · orders bileşenleri **12 aria-label** (AdisyonPanel 458/520/545/618, OrderProductDetailModal 270/292, ProductCard 82/90/107, TakeawayCartPanel 109/124/159) · `CustomerPickerModal.tsx:125-131` (3 site: kayıp key fallback + 2 hardcoded toast) · AppShell:50, Sidebar:152, TableCard:239-250 (`formatElapsed` "X sa Y dk Z sn"), GroupListRow:23-24 (**ikinci para-formatlayıcı** `formatTL` — formatMoney bypass), NewGroupDrawer:544, ProductEditorPage:725, HourlyRevenueSkeleton:10.
- **Kanıt:** Hat C sistematik grep + tam-dosya okuma; "doğrulanmış minimum küme" (ikon-bitişik düz metin regex'i atlatabilir — Blok 0'ın satır-bazlı ~87 sayımıyla fark bundan + kapsam farkı). **5 site için key zaten tanımlı ama çağrılmıyor:** `payment.split.{emptyPayer,removeOne,commitPayer}`, `payment.type.{cash,card}`.
- **Etki:** CLAUDE.md çekirdek direktif 4 ihlali; bakım/tutarlılık; v5.1 çok-dil kapısını kapatır. · **Öneri:** Blok 13'te 3 PR'lık grup: Split (5 bedava + 8 yeni key) → orders a11y seti → kalanlar. · **Etiket:** MVP-fix (kural ihlali)

### [HIGH] [HCI] Hızlı Öde: büyük tutar onayı yok (ID: W9-HCI-02) — CANLI TEYİT
- **Dosya:** `apps/web/src/features/payment/components/QuickPaymentModal.tsx:271-310`
- **Kanıt (canlı):** Nakit dokunuşu → anında `POST /payments` 201 (ara onay yok). Checklist `docs/hci/pos-checklist.md:40`: "Büyük tutarlı ödemede (> 1000 TL) onay modal'ı" — karşılanmıyor. Modal tutarı belirgin gösteriyor (hafifletici); ADR-033 void→reopen kurtarma yolu var (BLOCKER olmama nedeni).
- **Etki:** Kalabalık masada yanlış yöntem/erken tahsilat; düzeltme sürtünmeli (void sebep+yetki+audit). · **Öneri:** `remainingCents > 100_000` → ikinci "Onayla — ₺X" adımı. · **Etiket:** MVP-fix

### 2.2 MEDIUM (12)

### [MEDIUM] [BUG] `useAssignCustomer` yanıt-şekli uyumsuzluğu — dormant mayın (ID: W9-A-01) — CANLI dormant teyit
- **Dosya:** `apps/web/src/features/orders/api.ts:576-595` · **Kanıt:** hook `Promise<OrderWithItemsResponse>` (`{data:{order,items}}`) cast ediyor; backend `PATCH /orders/:id/customer` düz camelCase DTO döner (`orders.ts:1368 toOrderResponseDto`). Bugün çağrı yeri sonucu OKUMUYOR → canlıda PATCH 200 + konsol temiz (S77-sınıfı hata görünmez). Aynı dosyada `useMergeOrderTable` yorumu bu tuzağa açıkça uyarıyor — bu hook ihlal ediyor. · **Etki:** İlk `.data.order` erişiminde S77 tekrarı (başarılıyken UI hata). · **Öneri:** dönüş tipini düz DTO'ya düzelt. · **Etiket:** MVP-fix (1 satır)

### [MEDIUM] [ROB] Tek kök ErrorBoundary; route-level izolasyon yok (ID: W9-A-02, HIGH→MEDIUM kalibre)
- **Dosya:** `App.tsx:17-24` · **Kanıt:** herhangi bir render hatası tüm POS'u "Yeniden Yükle"ye düşürür; in-memory sepet (ADR-013 §1 "pending local" — bilinçli karar) kaybolur. · **Öneri:** route-level boundary (özellikle sipariş ekranı); sepet kararı ADR'li, değişmez. · **Etiket:** MVP-fix

### [MEDIUM] [ROB] Bağlantı-durumu göstergesi yalnız KDS'de (ID: W9-A-04)
- **Kanıt:** `useConnectionStatus` tek tüketici `KdsPage.tsx:42`; Masalar/Sipariş/Ödeme realtime kopunca sessiz-stale (canlıda API-ölü Masalar stale "5 Boş 1 Dolu" gösterdi). · **Öneri:** AppShell'e global çevrimdışı banner'ı. · **Etiket:** MVP-fix

### [MEDIUM] [ROB] Çoklu-sekme refresh yarışı (ID: W9-A-05, doğrulanmamış)
- **Kanıt (kod-tespiti):** `refreshPromise` sekme-başına singleton (`lib/api.ts:36`); backend rotation+reuse-detection → 2 sekme eşzamanlı 401'de teorik reuse tetiklenmesi. Tek-kasiyer tek-sekme operasyonda olasılık düşük; canlı repro yazılmadı. · **Öneri:** Blok 13'te BroadcastChannel kilidi değerlendir / kabul-et belgele. · **Etiket:** v5.1-backlog

### [MEDIUM] [PERF] Müşteri listesi sanallaştırmasız; "Daha Fazla" birikimli (ID: W9-A-06)
- **Dosya:** `CustomersPage.tsx:64,97-108,419-476` · **Kanıt:** accumulated state küçülmüyor; 1469 kayıtta tüm satırlar DOM'a binebilir. Debounce (300ms) DOĞRU. Canlı ölçüm 2 kayıtla anlamsız → prod-ölçekli ölçüm Blok 13 yük-harness'ına devredildi. · **Öneri:** sayfa boyutu sınırı ölçüm-sonrası; gerekirse react-virtual. · **Etiket:** ölçüm-sonrası

### [MEDIUM] [SEC/KVKK] Bilinmeyen arayan telefonu URL query'de (ID: W9-SEC-01)
- **Dosya:** `caller-id/orderRoute.ts:22` · **Kanıt:** `params.set('phone', phone)` → `/orders/new?phone=05...`; tarayıcı geçmişi/autocomplete'te PII (paylaşımlı kasa PC). Kayıtlı müşteri opak `customerId` (doğru). · **Öneri:** `navigate(path, {state})`. · **Etiket:** MVP-fix

### [MEDIUM] [SEC/KVKK] Müşteri arama + telefon-silme PII'yi URL'de taşıyor (ID: W9-SEC-02)
- **Dosya:** `customers/api/customers.ts:42,160` · **Kanıt:** `GET /customers/search?search=<isim/telefon>` + `DELETE /customers/:id/phones/<telefon>` → Nginx access-log'a PII. · **Öneri:** Blok 13 backend-ortak fix (POST-body arama / log-maskeleme); response-PII devriyle aynı pakete. · **Etiket:** ADR-hafif

### [MEDIUM] [SEC] `extractError` serbest-metin fallthrough + 11 dosyada lokal kopya (ID: W9-SEC-03 + W9-A-07 ailesi)
- **Dosya:** `CustomersPage.tsx:131`, `CustomerDetailPage.tsx:100`, `OrderScreenPage.tsx:364-377` (+8 kopya) · **Kanıt:** `data?.error?.message ?? fallback` — ADR-006 zarfında `message` YOK → bugün hep fallback (dormant); merkezi `lib/error.ts getErrorMessage` (yalnız i18n-key, katı) dururken yerel kopyalar drift. · **Öneri:** tek merkeze topla; fallthrough'u kaldır. · **Etiket:** MVP-fix

### [MEDIUM] [HCI/a11y] İç-içe/sahte interaktif kontroller (ID: W9-HCI-04) — CANLI ölçüldü
- **Dosya:** `tables/components/TableCard.tsx:142-168` · `SplitPaymentModal.tsx:1085-1137` · `QuickPaymentModal.tsx`
- **Kanıt (canlı):** Split Nakit/Kredi Kartı = `span[role="button"]` **184×36** (gerçek button değil); QuickPay diyaloğunda işlem-tipi + Nakit/Kart butonlarının erişilebilir adı erişilebilirlik ağacında BOŞ; TableCard `<button>` içinde `span[role=button]` (HTML interactive-content ihlali), focus-ring yok. · **Öneri:** gerçek `<button>` + aria-label. · **Etiket:** MVP-fix

### [MEDIUM] [HCI] Ödeme modallarında 32×32 custom kapatma (ID: W9-HCI-05, HIGH→MEDIUM kalibre) — CANLI 32×32 ölçüldü
- **Dosya:** `SplitPaymentModal.tsx:411-419` · `DetailedPaymentModal.tsx:344-352` · **Kanıt:** her ikisi 32×32 (paylaşılan Dialog 44×44; checklist 52). Split durumu server-side kalıcı (`split-state`) → yanlış-kapatma veri kaybetmiyor (MEDIUM gerekçesi). · **Öneri:** DialogContent standart X'ine geç. · **Etiket:** MVP-fix

### [MEDIUM] [HCI] Sipariş ekranı dokunma hedefleri sistematik 52px altı (ID: W9-HCI-03G — D'nin 06/07/08/13 gruplandı) — CANLI ölçüm tablosu
- **Kanıt (getBoundingClientRect):** Ödeme/Hızlı Öde **115×46** · panel Artır/Azalt **40×40** (aralarında 32px — D'nin "2px" iddiası düzeltildi) · kart pending şeridi **46×48** + kırmızı zeminde "+" (renk-konvansiyon çelişkisi) · Müşteri/Yazdır/Taşı/Kaldır **40-50×40** · kategori sekmeleri **h40** · hamburger **42×42**. Checklist satır 108: "minimum 52×52". Karşıt-örnek: Masalar panosu sekmeleri 52px bilinçli uygulanmış. · **Öneri:** sipariş ekranı boyut geçişi tek PR (Tailwind ölçek sabitleri). · **Etiket:** MVP-fix

### [MEDIUM] [HCI] Zorunlu-özellik hatası modal görünür alanı dışında kalabiliyor (ID: W9-HCI-09)
- **Dosya:** `OrderProductDetailModal.tsx:162-173` · **Kanıt (kod-tespiti):** inline hata `max-h-[60vh]` scroll bölgesinde; scroll-to-error/toast yok → "Kaydet çalışmıyor" algısı. · **Öneri:** ilk hataya scrollIntoView. · **Etiket:** MVP-fix

### [MEDIUM] [TR] CSV dışa-aktarma başlıklarında 3 ASCII yazım hatası (ID: W9-TR-01 — E'nin 001/002/003 gruplandı)
- **Dosya:** `i18n/locales/tr.json:1127,1129,1131` · **Kanıt (doğrulandı):** `"Tum Telefonlar"`, `"Toplam Siparis"`, `"Olusturma"` — müşteri-görünür export belgesine gidiyor. (E'nin önerisindeki "Toplam Siparış" yazımı da hatalıydı; doğrusu **"Toplam Sipariş"**.) · **Öneri:** 3 string düzelt. · **Etiket:** MVP-fix (1 dk)

### 2.3 LOW (8)

- **W9-SEC-05** [SEC] CSP başlığı yok (`index.html` + Nginx) — inline-script yok, XSS-sink yok → savunma-derinliği. Nginx tarafında `default-src 'self'` + `frame-ancestors 'none'`. (Blok 13 Nginx paketi)
- **W9-SEC-06/07** [SEC-hijyen] sourcemap `hidden` emit + console drop yok — prod'da `.map` serve edilmediğini Nginx'te doğrula; `esbuild.drop` değerlendir.
- **W9-SEC-08** [KVKK-not] Caller popup tam numara + global tüm rollere — operasyonel gereklilik kabulü; rol-bazlı kısıtlama v5.1 değerlendirmesi.
- **W9-I18N-02** [i18n] Kayıp key: `customers.errors.phoneExists` (`CustomerPickerModal.tsx:125` defaultValue ile ayakta; `PHONE_ALREADY_EXISTS`=tr.json:1285 kullanılmıyor) — key'i mevcut koda yönlendir.
- **W9-I18N-03** [i18n-hijyen] 19+ kullanılmayan key (placeholder-dönem kalıntısı: `dashboard.nav*`, `tables.phase3Modal.*`, `sidebar.soon`...) + duplike değerler (`"Kaydet"` ×17, `"Vazgeç"` ×10 — `common.*` dururken ekran-lokal kopyalar).
- **W9-TR-02** [TR] Dashboard KPI `"averageBill": "Ortalama Hesap"` (tr.json:49) glossary ihlali ("Bill"→"Adisyon"; reports.kpi:169 doğru) — CANLI görüldü + başlık büyük/küçük tutarsızlıkları (E-004/005/006: "Paket siparişler" vs "Paket Sipariş", "Yapım Aşamasında" ×2 biçim) + `itemsShort_one` ICU tekil formu.
- **W9-QUAL-01** [DEAD] Logout mantığı 2 kopya (`AppShell.tsx:30-40` vs `auth/api.ts useLogout`) — hook'a bağla.
- **W9-HCI-LOW-G** [HCI grup] DetailedPayment 4-aksiyon grid'i yalnız renk+etiketle ayrışıyor (iki-aşamalı akış riski azaltıyor) · IncomingCallPopup disabled açıklaması hover-only `title` (dokunmatikte erişilmez; kırmızı rozet telafi ediyor) · CategoryTabs 7-kategori sınırı yok (canlı 2 kategoriyle test edilemedi) · persisted void 40×40 (onay katmanı var) · **CustomerPickerModal başlığı dine_in'de "Müşteri seçimi zorunlu" — atama OPSİYONEL, başlık yanıltıcı (yeni, canlıda görüldü)** · "Geri Al" (taslak-undo) vs "Ödemeyi Geri Al" (void) adlandırma yakınlığı — **`docs/hci/exceptions.md` YOK; S84 çıkış-uyarısız kararı + bu istisnalar resmî kayıtsız** → dosyayı oluştur (doc-debt).

## 3. Devir cevapları (Blok 2-8 + chip'ler)
- **response-PII UI'da gösteriliyor mu?** HAYIR — `getErrorMessage`/`extractError` `details`'i okumuyor; ham PG detail yalnız Network sekmesinde (W9-SEC-04→LOW-not; kalıcı çözüm backend, Blok 13 tekil fix DB-SEC-01 ailesi).
- **SplitPaymentModal i18n (chip task_20f0e0c9):** TEYİT — 13 site, 5'i tanımlı-ama-çağrılmayan key (bkz. W9-I18N-01).
- **Kaydet-ödeme E2E (chip task_4455260a):** Bu blokta yazılmadı (fix-yasağı: E2E gerçek akış fix'iyle birlikte anlamlı) → Blok 13'e devir; bu oturumda aynı akış CANLI manuel doğrulandı (Kaydet→Hızlı Öde→201+DB kaydı).

## 4. Metodoloji notu — geçici-UI (toast) canlı doğrulaması
"Kaydet hatası sessiz" ilk gözlemi YANLIŞ ALARMdı: toast ömrü (4 sn) < tarayıcı-aracı round-trip'i → her ekran görüntüsü toast'ı kaçırdı. Kanıt ancak **in-page tek-zaman-çizelgeli enstrümantasyon** (sonner metod sarmalama + `data-sonner-toast` 100ms poll + JS-tetikli click AYNI çağrıda) ile kesinleşti: çağrı VAR, render 111ms, ömür 4,3sn. **Ders (S77'nin uzantısı):** mutation-shape/toast sınıfı iddialar canlı doğrulanmalı AMA geçici-UI iddiası tek-zaman-çizelgeli in-page ölçüm ister; screenshot-polling yanlış-pozitif "sessiz hata" üretir.

## 5. Blok 13'e taşınanlar
1 numaralı desen-fix: **hata≠boş-durum** (4 ekran, tek PR) · Yazdır bağla · Split i18n (5 bedava key) + orders a11y · >1000₺ onay · dokunma-hedefi ölçek PR'ı · extractError merkezileştirme · PII-in-URL çifti (SEC-01/02, backend-ortak) · CSV başlık 3 typo · exceptions.md oluştur · assign-customer tip düzeltme. **Tema tekrarı (serilerle):** response-PII (4. blok tekrarı — merkezi fix şart) · "status-filtresiz/durum-maskeleme" ailesine web varyantı olarak "error-maskeleme boş-durum" eklendi.
