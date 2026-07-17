# Blok 10 — apps/mobile (React Native / Expo): derin denetim

> Derin denetim serisi Blok 10. **Tarih:** 2026-07-12 · **Branch:** `audit/10-mobile` (base `a40b28a`) · **Model:** Fable 5.
> **Yöntem:** 5 paralel hat (A: qa-engineer — ROB/BUG/ağ · B: security-reviewer · C: i18n-key-checker · D: hci-reviewer · E: turkish-ux-reviewer) + ana-context kod-doğrulama & severity kalibrasyonu (ADR-026 Amendment metinleri decisions.md'den birebir kontrol edildi).
> **Canlı doğrulama sınırı:** Gerçek Android cihaz bu oturumda YOK — tüm bulgular statik kod-doğrulamalı (`tsc --noEmit` temiz); cihaz gerektiren maddeler §5'te "cihaz-smoke" listesinde. Prod kod DEĞİŞTİRİLMEDİ.
> **Testler:** `apps/mobile/audit/` 2 dosya (node:test, bağımsız): **8 kasıtlı KIRMIZI + 7 yeşil.** Koş: `node --test apps/mobile/audit/`.
> **Ham bulgu:** A:8 · B:5 · C:4 grup · D:11 · E:5 → konsolide **22 bulgu: 1 BLOCKER · 2 HIGH · 10 MEDIUM · 9 LOW.** (D'nin 2 HIGH'ı ADR-026 Amd E ile bulgu-değil'e kalibre edildi.)

---

## 0. Yönetici özeti

**Mobil uygulama disiplinli yazılmış — i18n %100 key'li (web'in 38-site ihlaline karşı 0), token/PII/mock hijyeni örnek, ödeme yolu idempotency+kilit ile SAĞLAM. Tek gerçek BLOCKER sipariş-kaydetme yolunda: ödemeye verilen idempotency koruması siparişe verilmemiş; zayıf WiFi + "Tekrar Dene" = kalem duplikasyonu.**

**✅ Güçlü çıkanlar (kod-doğrulandı):**
- **Ödeme yolu ÖRNEK:** idempotency key `useRef`'te attempt-başına sabit + retry'de aynı key + backend replay-guard (ADR-014 §4) + `isPending` disabled + QuickPaySheet ödeme sürerken backdrop/X/Android-geri hiçbir yoldan kapanmıyor.
- **Realtime emit-envanteri TAM:** mobilin dinlediği 7 event apps/api emit siteleriyle isim+payload eşleşiyor (Hat A'nın 2 karşı-hipotezi kod okunarak yanlışlandı) — S74 "kontrat sessizce kırık olabilir" endişesi mobil için KAPANDI.
- **i18n:** 41 dosyanın tamamında hardcoded string **0** · kayıp key 0 · interpolasyon hatası 0 (web Blok 9: 38 site — mobil tam tersi).
- **SEC:** token yalnız `expo-secure-store` (AsyncStorage hiç yok) · src'de `console.*` **0** → PII log riski yok · response-PII mobilde render edilmiyor (`toApiError` yalnız `error.code`) · tenant yalnız JWT claim (spoof yüzeyi yok) · socket token auth-payload'da · `USE_MOCK=false` derleme-sabiti (mock sızıntı yolu yok).
- `any` 0 · zod `.parse` hataları yumuşak "tekrar dene" UI'ına düşüyor (çökme/ham hata yok) · K6 gating tutarlı (yetkisiz aksiyon hiç render edilmez) · 52pt dokunma hedefleri sabitten · Move/Merge stale-state koruması sağlam.

**🔴 1 BLOCKER:**
- **M10-A-01** — `POST /orders` + `POST /orders/:id/items` idempotency-key'siz (orders.ts:872 yorumu: "Idempotency key YOK (v5.1 forward-ref)" — **go-live ÖNCESİ verilmiş erteleme kararı**); mobil `handleSave` catch'i cart'ı koruyup **"Tekrar Dene" ile aynı cart'ı yeniden gönderiyor**; 15sn timeout "kesin başarısız" ile "belki başarılı"yı ayırt etmiyor. Açık-masa yolunda (rush-hour'da en yaygın) her retry kalemleri **deterministik duplike eder** → 2× mutfak fişi + şişmiş adisyon (müşteri fazla öder / restoran zarar). Ödeme yolundaki koruma (ADR-014 §4) birebir şablon.

**🟠 2 HIGH (ağ-dayanıklılığı ailesi):** offline yönetimi RN'de fiilen yok (netinfo/onlineManager/AppState 0 kullanım → offline'da "duraklat-devam et" yerine düz hata; kalıcı bağlantı göstergesi de yok) · socket reconnect'te resync yok → WiFi kesintisinde kaçan event'ler telafi edilmiyor, ekran **sessizce bayat** kalıyor (hata görünümü bile yok — en sinsi tür).

**Kalibrasyon (ana-context):** D'nin M10-HCI-01 (Kaydet sessiz başarı) ve M10-HCI-02 (dirty-exit onayı yok) bulguları **ADR-026 Amendment E (2026-06-29) ile ürün sahibi kararı** — bulgu DEĞİL (decisions.md:10472 birebir: "Kaydet-success Alert + dirty-exit dialog kaldırıldı, cart-loss kabul"). Kalan gerçek sorun: OrderScreen.tsx JSDoc'u hâlâ "Leaving with a dirty cart prompts a confirm (K4)" diyor — **bayat dokümantasyon** (LOW). D'nin M10-HCI-04'ü (çift fiş) A-06 ile birleşti → MEDIUM (Blok 8 P8-ENQ-09 emsali: para değil kağıt; server-side dedup da yok). E'nin "Temizlikte" HIGH'ı → MEDIUM (terim tutarsızlığı, yanlış yönlendirme değil).

### En kritik 3
1. **M10-A-01** (BLOCKER) — orders idempotency: payments desenini kopyala (client key + backend replay-guard). **Web Kaydet de aynı endpoint'leri key'siz kullanıyor** → fix backend+2 istemci, Blok 13'te tek PR.
2. **M10-A-03** (HIGH) — `socket.on('connect', → tables/orders/areas invalidate)` — tek satırlık resync, sessiz-bayat veriyi kapatır.
3. **M10-A-02** (HIGH) — `@react-native-community/netinfo` + `onlineManager`/`focusManager` bağla (TanStack resmi RN deseni) + başlığa kalıcı bağlantı rozeti.

---

## 1. Kapsam & yöntem
**Denetlenen:** `apps/mobile/src/**` (44 dosya) — screens/{Login,Tables,Order,Settings}, features/{orders,payments,tables}, api/* (9), store/*, realtime/socket, mock/* (5), navigation, config, App.tsx + app.json/eas.json. Çapraz: apps/api routes (yanıt şekilleri + emit envanteri), ADR-025/026/027 + Amendment'lar (decisions.md), docs/hci/pos-checklist.md, web tr.json (terim paritesi).
**Araç:** statik okuma + grep-envanter + `tsc --noEmit` (temiz). Cihaz smoke YOK (bkz. §5).

## 2. Bulgular

### 2.1 BLOCKER (1)

### [BLOCKER] [ROB/PARA] Sipariş kaydet yolunda idempotency yok + retry aynı cart'ı yeniden gönderiyor (ID: M10-A-01) — kod-doğrulandı (3 ayak)
- **Dosyalar:** `apps/api/src/routes/orders.ts:872` ("Idempotency key YOK (v5.1 forward-ref)"; items route'unda da hiçbir replay-guard yok — grep doğrulandı) · `apps/mobile/src/screens/OrderScreen.tsx:148-193` (catch → Alert "Tekrar Dene" → `void handleSave()`; cart yalnız başarıda temizleniyor; retry'da `activeOrderQuery.data` CACHE'ten okunuyor) · `apps/mobile/src/api/http.ts:25` (15sn AbortController — "yanıt kayboldu" ile "hiç gitmedi" aynı NETWORK_ERROR).
- **Senaryo (deterministik, race gerektirmez):** zayıf WiFi'da Kaydet → sunucu işledi, yanıt 15sn'de gelmedi → NETWORK_ERROR → garson "Tekrar Dene" → açık-masa yolunda `addOrderItems` kalemleri İKİNCİ kez yazar → 2× mutfak fişi + adisyon tutarı şişer. Boş-masa yolunda `TABLE_ALREADY_OCCUPIED` unique kısmi ağ (409) var ama generic hata mesajı garsona ilk denemenin başarılı olduğunu söylemiyor.
- **Kalibrasyon notu:** Erteleme kararı belgeli AMA go-live öncesi verildi; bugün prod CANLI + mobil UI retry'ı aktif davet ediyor + restoran WiFi'ı gerçek zayıf. Blok 8 P8-ENQ-09 emsalinden farkı: orada kağıt israfıydı, burada **adisyon parası**. MONEY-01/DB-TX-01'den sonra serinin 3. gerçek BLOCKER'ı; aynı Blok 13 para-bütünlüğü paketine girmeli.
- **Öneri:** payments deseni: client `Idempotency-Key` (attempt-sabit, retry'de aynı) + backend (tenant,key) replay → mevcut kaydı 200 dön. **Web Kaydet aynı endpoint'leri kullanıyor** (`apps/web/.../OrderScreenPage.tsx handleSave`) — elle yeniden-tıklama aynı riski taşır; fix üç parça (api + web + mobile). · **Etiket:** MVP-fix (Blok 13 öncelik 1)

### 2.2 HIGH (2)

### [HIGH] [ROB] TanStack Query RN online/focus entegrasyonu yok + kalıcı bağlantı göstergesi yok (ID: M10-A-02, D'nin M10-HCI-03'ü ile birleşik)
- **Kanıt:** `queryClient.ts` yalnız `retry:1`; `netinfo`/`onlineManager`/`focusManager`/`AppState` repo-genelinde 0; `http.ts` 15sn timeout → offline'da 15sn "Kaydediliyor…" sonra düz hata; hiçbir ekranda bağlantı rozeti yok. **Mitigasyon:** pull-to-refresh + "Tekrar Dene" butonları var (BLOCKER olmama nedeni).
- **Etki:** checklist "sync durumu sürekli ekranda + internet yokluğunda görünür uyarı" maddeleri karşılanmıyor; garson sorunu ancak 15sn sonra öğreniyor. · **Öneri:** netinfo + onlineManager/focusManager (App.tsx) + başlık rozeti; timeout'u düşür veya ara-durum göster. · **Etiket:** MVP-fix

### [HIGH] [ROB/Realtime] Socket reconnect'te tam-resync yok — sessiz bayat veri (ID: M10-A-03)
- **Kanıt:** `App.tsx:34-80` RealtimeBridge yalnız 7 domain event'ine invalidate bağlıyor; `socket.ts` reconnection sonsuz-retry'lı AMA `on('connect')` → invalidate YOK; Socket.IO kopukluk sırasındaki event'leri replay etmez.
- **Etki:** WiFi kesintisi sırasında başka terminal masa değiştirir → telefon reconnect olur ama ekran "görünüşte normal" ESKİ veriyi gösterir; hata/uyarı yok → garson dolu masayı boş sanabilir. · **Öneri:** `socket.on('connect', () => invalidate tables/areas/orders/payments)`. · **Etiket:** MVP-fix (tek satır aile)

### 2.3 MEDIUM (10)

- **M10-A-04 [PERF/Realtime]** — RealtimeBridge TEK `invalidate()` closure'ı menü kataloğunu da her sipariş event'inde yeniden çektiriyor (`staleTime` invalidate ile bypass olur); rush-hour'da gereksiz trafik/pil. Öneri: event-grubu başına ayrı closure. (`App.tsx:44-61`)
- **M10-A-05 [DEAD/Doküman-kod]** — `canWaiterEditOrderItem` (ADR-008 §7b: own+new düzenlenebilir) hesaplanıyor ama HİÇBİR stepper/void UI'ı render edilmiyor; `client.ts`'te item-PATCH fonksiyonu da yok → garson kendi yanlış girdisini mobilde DÜZELTEMEZ; yorum "become editable in PR-5d" bayat (PR-5d bitti, kapsamında yoktu). Öneri: ya tamamla ya ADR'de "v5.1" diye netleştir. (`AdisyonSheet.tsx:112-136`, `gating.ts`)
- **M10-PRINT-01 [ÇiftTetik]** (D-HCI-04 + A-06 birleşik) — "Adisyon Yazdır": sheet mutate'ten ÖNCE kapanıyor, `printMutation.isPending` hiçbir UI'da kullanılmıyor, ikinci dokunma kilidi yok → çift fiziksel fiş (kağıt; para değil). Server-side print dedup de yok (Blok 8 P8-ENQ-09 aynı aile — ADR-004 §A3.4 ertelemesinin prod-canlı yeniden değerlendirmesi). Kontrast-iyi-örnek: QuickPaySheet kilidi. (`TableActionsController.tsx:75-84`, `TableActionSheet.tsx`) — cihaz-smoke-gerek (pencere genişliği)
- **M10-HCI-05 [Okunabilirlik]** — varsayılan 3-sütunda ürün adı **12pt** / fiyat **13pt** (`roomy = width>=140` tipik telefonda ~116px → hiç tetiklenmez; `DEFAULT_PRODUCT_COLUMNS=3`) — checklist 14pt minimumu altında, kurulum-varsayılanı. Öneri: 3-sütun tipografisini ≥14/15'e dengele veya default 2. (`ProductCard.tsx:112,120`, `settings.ts:20`)
- **M10-HCI-06 [Fitts]** — QtyStepper "+" hitSlop'u (11px) kart kenarını ~7px aşıyor, kolon arası GAP 4px → komşu ürüne yanlış-ekleme taşması. cihaz-smoke-gerek. (`QtyStepper.tsx:19-22`, `OrderScreen.tsx:48`)
- **M10-HCI-07 [Undo]** — miktar 1'de "−" aynı konumda çöpe dönüşüyor, tek dokunuş satırı siler, undo/onay yok (checklist "satır silme undo ≥5sn"). Henüz-kaydedilmemiş satır → felaket değil, zaman kaybı. (`ProductCard.tsx:72`, `cart.ts:107-117`)
- **M10-HCI-08 [Kontrast]** — kategori tile metni admin-serbest `category.color` üstünde; luminance/fallback hesabı yok → pastel renkte okunmaz metin olası (WCAG AA yok). cihaz-doğrulama-gerek. (`CategoryGrid.tsx:33-46`)
- **M10-SEC-01 [Auth]** — logout yalnız SecureStore siliyor; `POST /auth/logout` (revoke) çağrılmıyor → refresh token doğal expiry'ye kadar sunucuda canlı. Öneri: best-effort revoke (offline'da yut). (`store/auth.ts:82-93`)
- **M10-SEC-02 [Config]** — Android prod'da cleartext'in kapalı olduğu garanti değil (`usesCleartextTraffic` explicit yok; config.ts prod HTTPS zorluyor → etki sınırlı). Öneri: `expo-build-properties` ile explicit kapat. (`app.json`)
- **M10-TR-CONS [Terim/Ton]** (C-6 + E-01/03/05 birleşik) — web↔mobil ve mobil-içi dil tutarsızlıkları: onay-iptal web "Vazgeç"/mobil "Geri" (sistemik) · merge hata metinleri 3/6 farklı (mobil `notFound` "Adisyon bulunamadı" — glossary "sipariş" der, web doğru) · "Ödenecek Toplam" vs "Ödenecek Tutar" · masa durumu web "Temizleniyor"/mobil "Temizlikte" · geçen-süre web MM:SS / mobil kaba-birim · mobil-içi sen/siz karışımı (forgotHint "Şifreni…" ↔ networkError "…kontrol edin" ↔ save.error "Bağlantını… dene"). Kasiyer↔garson aynı terimi görmeli; tek konsolidasyon PR'ı. (`apps/mobile/.../tr.json` ↔ `apps/web/.../tr.json`)

### 2.4 LOW (9)

- **M10-HCI-09** — Move/Merge onay aşamasında backdrop-tap seçimi sessizce sıfırlıyor (commit yok → yalnız sürtünme). (`MoveTableSheet.tsx:154-183`)
- **M10-HCI-10** — başlık ikonları yalnız ikon (accessibilityLabel var, görünür metin yok) — checklist "ikon+metin"; yaygın ikonlar, polish.
- **M10-HCI-11** — sepet rozeti 11pt (badge deseni, dokunma hedefi etkilenmiyor).
- **M10-SEC-03** — dev LAN IP (`config.ts:39`) + mock `DEMO_PASSWORD` string'leri bundle'da (guard'lı, gerçek secret değil) — `__DEV__` içine al.
- **M10-SEC-04** — FLAG_SECURE yok (ekran görüntüsü koruması) — POS bağlamında düşük.
- **M10-SEC-05** — deep-link scheme tanımlı, handler yok — navigator auth-gate'li; ileride eklenirse dikkat.
- **M10-QUAL-01** (A-08 + K4-JSDoc birleşik) — bayat yorum çifti: `OrderScreen.tsx:60` "dirty cart prompts a confirm (K4)" (Amd E ile kaldırıldı!) + "mocked here, real transport in PR-5d" (bitti) · `tables/queries.ts:56-58` "mobile board has no listener yet" (App.tsx dinliyor). Doküman-kod güveni için düzelt.
- **M10-I18N-01** — 5 kullanılmayan key (`app.title/subtitle`, `common.cancel/errorTitle`, `auth.logout`) + 6 duplike-değer kümesi ("Geri"×4, "Artır/Azalt"×2…) — konsolidasyon.
- **M10-TR-02** — buton büyük/küçük harf tutarsızlıkları ("Giriş yap" ↔ web "Giriş Yap"; "Tekrar Dene" ↔ metin-içi "tekrar dene") — TR-CONS PR'ına ek.

### Bulgu-değil'e kalibre edilenler (şeffaflık)
- **Kaydet sessiz-başarı** (D-HCI-01) + **dirty-exit onayı yok** (D-HCI-02) + **cart persist yok** (A-07): üçü de **ADR-026 Amendment E** (decisions.md:10472, 2026-06-29) ürün-sahibi kararı — "tahta güncellemesi = onay; cart-loss kabul; auto-persist v5.1". Kalan iş yalnız M10-QUAL-01 (bayat JSDoc) + `docs/hci/exceptions.md` oluşturulması (Blok 9'la ortak doc-debt).
- **mock/* Türkçe literaller**: `USE_MOCK=false` sabit → ölü fixture, i18n ihlali değil (C tespiti).

## 3. Devir cevapları & çapraz-katman
- **Realtime emit-bypass teması (SD-T-B-01 ailesi):** mobil DİNLEYİCİ tarafı temiz — 7/7 event isim+yol eşleşmesi doğrulandı; sorun yalnız emit-taraf zod-helper bypass'ında kalıyor (Blok 4/5 bulgusu, değişmedi).
- **response-PII teması:** mobil de web gibi RENDER ETMİYOR (`toApiError` yalnız code) — merkezi backend fix'i bekleyen 4-blok teması, mobilde yeni yüzey yok.
- **YENİ çapraz-katman (Blok 13'e):** M10-A-01 idempotency fix'i **web'i de kapsamalı** (aynı endpoint'ler, elle yeniden-tıklama); tek backend replay-guard + iki istemci key üretimi.
- **Kaydet-ödeme E2E chip (task_4455260a):** Blok 9'daki gibi Blok 13'e devir (fix'le birlikte anlamlı).

## 4. Cihaz-smoke listesi (kullanıcı, gerçek Android — fix'ler ÖNCESİ 10 dk)
1. Uçuş modu → Kaydet: hata kaç saniyede görünüyor, mesaj ne diyor? (M10-A-02)
2. WiFi kapat-aç → başka cihazdan masa değiştir → telefon kendiliğinden güncelliyor mu? (M10-A-03 — beklenen: HAYIR, bayat kalır)
3. Kebab → "Adisyon Yazdır"a çok hızlı çift dokun → kaç fiş çıktı? (M10-PRINT-01)
4. 3-sütun katalogda parlak ışıkta 12pt ürün adı okunabilirliği + "+" butonuna basarken komşu karta kaçırma (M10-HCI-05/06)

## 5. Blok 13'e taşınanlar
**Öncelik 1: M10-A-01 idempotency (api+web+mobile tek paket, MONEY ailesi).** Sonra: connect-resync (A-03, tek satır) · netinfo/onlineManager + bağlantı rozeti (A-02) · invalidate ayrıştırma (A-04) · print pending-kilidi + ADR-004 §A3.4 yeniden-değerlendirme (PRINT-01) · kalem-edit ADR netleştirme (A-05) · tipografi/undo/kontrast HCI paketi (HCI-05/06/07/08) · logout revoke + cleartext explicit (SEC-01/02) · web↔mobil terim konsolidasyonu (TR-CONS) · bayat-yorum temizliği + exceptions.md (QUAL-01).
