# v3 Caller ID + Müşteri — Davranış Analizi

> **Kaynak:** `D:\dev\restoran-pos-v3\` (READ-ONLY).
> **Yöntem:** Kod okuma + dosya/satır referansları. v5 PR-8 öncesi davranış brief'i.
> **Etiketleme:** `Kodda tespit:` (grep + dosya okuma) / `Doğrulanmamış:` (varsayım).

---

## 1. Donanım Bridge

v3'te **iki ayrı bridge yolu** var, paralel çalışabiliyor:

### 1A. Clipboard Listener (PowerShell)
**Dosyalar:**
- `D:\dev\restoran-pos-v3\scripts\callerid-clipboard-listener.ps1`
- `D:\dev\restoran-pos-v3\scripts\start-callerid-clipboard.bat`

**Davranış (Kodda tespit):**
- Pasif mod. Üçüncü parti caller-ID yazılımı (CIDShow vb.) numarayı Windows clipboard'una yazar; PS script `Get-Clipboard -Raw` ile her `PollMs` (varsayılan 300ms) okur.
- Rakam dışı her şeyi söker (`-replace "\D",""`); 10 veya 11 hane ise telefon kabul eder.
- Debounce: aynı numara `DebounceMs` (varsayılan 4000ms) içinde tekrar gelirse atlanır (`$lastDigits` + `$lastSentAt`).
- API base default `http://127.0.0.1:3001/api`. Endpoint `…/bridge/caller-id/incoming`. Header `X-Bridge-Token`.
- `BRIDGE_TOKEN` env zorunlu, eksikse `throw`.
- `source_type` = `callerid_clipboard` (default).

**Çalışan yan:** Sıfır donanım bağımlılığı, herhangi bir CIDShow benzeri programla çalışır.
**Zayıf yan:** Kullanıcının clipboard'unu kirletir — kasiyer ekranda arama yaparken yanlışlıkla telefon numarası yapıştırılabilir. Polling 300ms CPU'da küçük yük.

### 1B. .NET SDK Helper (CIDShow cid.dll)
**Dosyalar:**
- `D:\dev\restoran-pos-v3\tools\callerid-sdk-helper\CallerIdSdkHelper.csproj`
- `…\tools\callerid-sdk-helper\` altındaki `*.cs` (Program/Helper)
- `D:\dev\restoran-pos-v3\scripts\start-callerid-helper.bat`
- `D:\dev\restoran-pos-v3\scripts\build-callerid-helper.cjs`

**Davranış (Kodda tespit):**
- .NET 8 console app. CIDShow tarafından dağıtılan `cid.dll` üzerinden cihaz event'i alır (`cidshow_x64\cid.dll` veya `cidshow_x86\cid.dll`).
- Her event'te ham alanlar: `device_serial`, `line`, `phone`, `date_time`, `other` (filled/empty olarak loglanır).
- `NormalizeDigits()` rakam dışı her şeyi söker; `digits.Length is 10 or 11` filtresi.
- `IsDebounced(digits, line)` ile dahili debounce (line bazlı; `_debounceMs`).
- `--post-enabled false` log-only modu var.
- HTTP POST → `…/bridge/caller-id/incoming`, `X-Bridge-Token` header, body `{ phone, source_type, raw_payload: {device_serial, line, date_time, other, helper} }`.
- `source_type` = `callerid_sdk_helper`.
- Hatalar tek satır console.WriteLine; cihaz veya HTTP exception'da log + return.

**Çalışan yan:** Resmi SDK ile direkt cihaz olayı; clipboard kirliliği yok; metadata zengin (line/device_serial).
**Zayıf yan:**
- Yalnız Windows + .NET runtime + `cid.dll` ikilisi (x86/x64) gerekli.
- `cid.dll` versiyonlama yok — CIDShow güncellemelerinde kırılabilir.
- Lifecycle electron tarafına bağımlı (alt başlık 1C).

### 1C. Electron Lifecycle
**Dosya:** `D:\dev\restoran-pos-v3\electron\modules\callerIdProcess.cjs`

**Davranış (Kodda tespit):**
- `app.isPackaged` ise `…\bin\Release\net8.0\CallerIdSdkHelper.exe`, dev'de `dotnet run --project … .csproj`.
- `posConfig.bridge.token` veya `BRIDGE_TOKEN` yoksa helper hiç başlamaz (warn log).
- `restartMs` (default 15000ms, min 5000ms) — child process exit ederse otomatik restart.
- `callerIdHelperStopped` flag'i ile electron quit sırasında restart bastırılır.
- `killProcess` + `forceKillAfterTimeout` ile temiz kapanış.
- `apiBase` cloud yerine local: `http://127.0.0.1:${port}/api` (sunucu electron'la birlikte aynı host'ta).

**Çalışan yan:** Crash tolerans (auto-restart). Token yoksa silent skip.
**Zayıf yan:** v5'te electron yok — bu modül **birebir taşınamaz**, ayrı print-agent benzeri Windows servisine taşınmalı.

### 1D. v3 store-bridge (StoreBridge servisi)
**Dosyalar:** `D:\dev\restoran-pos-v3\store-bridge\` (`apiClient.js`, `config.js`, `index.js`, `callerid/`, `printers/`, `jobs/`)

**Doğrulanmamış:** `store-bridge/callerid/` dizinin içeriği bu pass'ta okunmadı. Muhtemelen alternatif/legacy yol; v3 büyük olasılıkla artık SDK helper + clipboard listener'ı tercih ediyor.

---

## 2. Backend — Caller ID Event Akışı

### 2A. Endpoint'ler

| Path | Auth | Kaynak |
|---|---|---|
| `POST /api/bridge/caller-id/incoming` | `bridgeAuth` (X-Bridge-Token) | `server/routes/bridge.js` |
| `POST /api/caller-id/incoming` | JWT (`authenticate, businessScope`) | `server/routes/callerid.js` |
| `POST /api/caller-id/simulate` | JWT | `…/callerid.js` (geliştirme) |
| `GET  /api/caller-id/history` | JWT | `…/callerid.js` (son 50 call) |
| `GET  /api/caller-id/recent?limit=` | JWT | `…/callerid.js` (popup polling) |
| `PATCH /api/caller-id/logs/:id/status` | JWT | `…/callerid.js` |

**Kodda tespit:** Cihaz/script `bridge` yolunu kullanır; UI `caller-id` yolunu kullanır. İkisi de aynı `processIncomingCall` servisini çağırır.
**Referans:** `D:\dev\restoran-pos-v3\server\routes\bridge.js` (caller-id/incoming bloğu §4 civarı), `D:\dev\restoran-pos-v3\server\routes\callerid.js`.

### 2B. processIncomingCall — Servis
**Dosya:** `D:\dev\restoran-pos-v3\server\services\callerIdService.js`

**Akış (Kodda tespit):**
1. `normalizePhoneDigits(rawPhone)` — boşsa 400.
2. **Server-side dedupe:** Son `CALLER_ID_DEDUPE_SECONDS = 5` sn içinde aynı `business_id + normalized_phone + source_type` ile `status='ringing'` kayıt varsa **yeni kayıt yok**, mevcut row `duplicate:true` ile döner.
3. `findCustomerPhoneRow(business, normalized)` — önce `customer_phones.normalized_phone` ile JOIN; bulamazsa **legacy fallback**: tüm satırları çekip in-memory `normalizePhoneDigits(cp.phone)` karşılaştırır.
4. Varsa `customer_id`, `customer_name_snapshot`, `address_snapshot` (default address > ilk address) doldurulur.
5. `INSERT INTO call_logs (id, business_id, phone, normalized_phone, customer_id, customer_name_snapshot, address_snapshot, source_type, status='ringing')`.
6. `auditLog` çağrısı (`event_type='incoming_call'`).
7. `incoming_calls` legacy tablosuna best-effort yazım (try/catch).
8. Return: `{callId, callLogId, phone, displayPhone, matched, customer, rawPayload}`.

**Frontend push — DOĞRULANMAMIŞ:** Socket.IO emit grep'inde `caller` için sadece pino doc'u çıktı (gerçek emit bulunamadı). Frontend popup, Socket yerine **`GET /caller-id/recent` polling** ile çalışıyor (IncomingCallContext, alt başlık 4D). Sunucu push yapmıyor — pull modeli.

**Çalışan yan:** Atomik DB write + audit + dedupe. Multi-source desteği (`source_type`).
**Zayıf yan:**
- 5 sn dedupe çok kısa; aynı arayan tekrar telefonu açarsa yanlış birleşebilir.
- Legacy `incoming_calls` halen yazılıyor (TODO yorumu var).
- Socket.IO emit yok → frontend her ~3-5 sn polling (KPI'a göre), gerçek "real-time" değil.
- `auditLog` PII-rich (`{phone, ...}`) — KVKK'da kayıt süresi tanımsız.

### 2C. Dedupe Karmaşası
İki katmanlı: PS/SDK helper'ında **client-side** debounce (4000ms / config), backend'de **server-side** 5sn. v5'te tek nokta yeterli — kuvvetli olan **backend** olmalı (cihaz değişebilir, sunucu sabit).

---

## 3. Müşteri Modeli

### 3A. DB Schema (3 tablo)
**Migration kaynağı:** `D:\dev\restoran-pos-v3\server\migrations\run.js:168`+

| Tablo | Önemli kolonlar | İndeksler |
|---|---|---|
| `customers` | id PK, business_id FK, full_name NOT NULL, **note**, **is_blacklisted**, **blacklist_note**, total_orders, last_order_at, created_at, updated_at | `idx_customers_business(business_id)` |
| `customer_phones` | id PK, customer_id FK, phone, **is_primary**, **normalized_phone** (sonradan ALTER ile eklendi, satır 686-688) | `idx_customer_phones_customer`, `idx_customer_phones_phone`, `idx_customer_phones_normalized` |
| `customer_addresses` | id PK, customer_id FK, title (default 'Ev'), address NOT NULL, address_note, is_default | (customer_id index implicit) |

**Kodda tespit:**
- `province / district / neighborhood` POST body'sinde alınıyor ama **şemada yok** (route satırlarında SADECE `address, address_note` kullanılıyor; il/ilçe/mahalle drop ediliyor — `D:\dev\restoran-pos-v3\server\routes\customers.js` POST bloğu).
- `0007_drop_legacy_customer_columns.js` migration var → şema bir refactoring geçirmiş.
- `first_name/last_name` route'ta var, schema'da yok; runtime'da ALTER ile eklenmiş olabilir (`Doğrulanmamış`).
- Soft delete **yok**. `DELETE` davranışı bu pass'ta okunmadı.

### 3B. phoneNormalize Util
**Dosya:** `D:\dev\restoran-pos-v3\server\utils\phoneNormalize.js`

| Girdi | Çıktı |
|---|---|
| `+90 5xx xxxx xxx` (12 hane, 905 prefix) | `0` + 10 hane → 11 hane |
| 13+ hane `90…` ile başlayan | strip + valide → 11 hane |
| `05xx…` (11 hane, 05) | aynen |
| `5xx…` (10 hane, 5 ile) | `0` prefix |
| Sabit hat / kısa / yabancı | rakamlar aynen (rejected değil) |
| boş | `""` |

`isTurkishMobile()`: `/^05\d{9}$/`.

**Çalışan yan:** Net spesifikasyon, edge-case'ler (12/13 hane) ele alınmış. Sabit hat reddedilmiyor — restoran müşterisi gerçekçiliği.
**Zayıf yan:** "Sabit hat aynen" tutmak dedupe'u zorlaştırır (ülke kodu/0 prefix'i farklı kayıtlar olabilir). v5'te E.164 (`+905…`) düşünülebilir.

### 3C. CRUD Endpoint'leri (`server/routes/customers.js`)

| Method | Path | Notlar |
|---|---|---|
| GET | `/api/customers?search=&phone=&page=&limit=` | search ≥2 char isim; phone substring; sayfalama default 50/maks 200 |
| GET | `/api/customers/:id` | + phones[] + addresses[] |
| POST | `/api/customers` | first/last veya full_name; phone + phone_2; tek transaction içinde phones + 1 default address |
| PUT (varsayılan) | `/api/customers/:id` | full_name + first/last + note; `recordEntityMutation` ile audit |
| POST | `/api/customers/:id/phones` | extra phone ekleme |
| (Doğrulanmamış) | `/customers/:id/addresses` (CRUD) | adres ekleme/silme route'u; bu pass'ta okunmadı |
| Bulk | import preview + commit (CSV/Excel?) | `importPreviewCache` token tabanlı |

**Validation:** Manuel (`cleanText`, `composeFullName`); zod yok. `first_name` boşsa 400.

**Çalışan yan:** Bulk import + audit + transaction.
**Zayıf yan:**
- `province/district/neighborhood` UI alıyor ama drop ediliyor (sessiz veri kaybı).
- DELETE / soft-delete yok.
- `total_orders` / `last_order_at` denormalized — ne zaman güncelleniyor `Doğrulanmamış`.

---

## 4. Frontend Akışları

### 4A. CustomersScreen
**Dosya:** `D:\dev\restoran-pos-v3\client\src\components\customers\CustomersScreen.jsx`

**Davranış:**
- Liste + sayfalama ("Daha fazla yükle" — append).
- Arama kutusu: ≥2 karakter; rakam içeriyorsa `?phone=`, yoksa `?search=`.
- Detay görüntüleme + stat'lar arka planda yükleniyor.
- CSV import + export (FileUp / Download lucide ikonları).

### 4B. CustomerDetailsModal (sipariş ekranından)
**Dosya:** `D:\dev\restoran-pos-v3\client\src\components\orders\CustomerDetailsModal.jsx`

**Davranış:**
- İki view: `'list'` (Adisyo-tarzı arama + kart liste) ve `'edit'` (form).
- Debounce'lu canlı arama (`searchDebounceRef`).
- Address editor inline (multiple addresses, default toggle).
- ConfirmDialog ile silme/değişiklik onayı.

### 4C. CallerIdScreen (yönetim ekranı)
**Dosya:** `D:\dev\restoran-pos-v3\client\src\components\callerid\CallerIdScreen.jsx`

**Davranış:**
- Test/simülasyon kutusu (`/caller-id/simulate`). Demo numaraları ekranda yazılı.
- "Arama Geçmişi (call_logs)" — son 50 kayıt; durum etiketleri Türkçe (`Çalıyor`, `Kapatıldı`, `Siparişe Dönüştü`, `Tamamlandı`).
- `useIncomingCall()` ile global banner'a refresh tetikler.

### 4D. IncomingCallContext (global popup)
**Dosya:** `D:\dev\restoran-pos-v3\client\src\context\IncomingCallContext.jsx`

**Davranış (Kodda tespit):**
- React context provider, app root'unda mount.
- `bannerCall` state — ekranın **üst-orta**'sına fixed position, z-index 10050, 440px max-width.
- "Kapat" + "Siparişi Aç" butonu.
- **Suppression:** `sessionStorage` `pos_caller_banner_suppressed_${userId}` — kullanıcı bazlı dismiss seti; aynı call.id tekrar göstermez.
- **`openOrder(call)`:**
  1. Suppress seti güncelle.
  2. `customer_id` varsa `getCustomer()` ile detay çek; default address seçilir; başarısızsa snapshot'tan minimal customer construct.
  3. `PATCH /caller-id/logs/:id/status` → `opened_order` (best-effort, hata yutuluyor).
  4. `navigate('/order/takeaway', { state: { orderType, customer, prefillPhone, callLogId } })`.
- **Çoklu kasiyer:** Backend filtreleme yok — `recent` endpoint'i `business_id` scope'lu, **TÜM kullanıcılara** aynı popup düşer. Suppression sadece per-user dismiss.

**Çalışan yan:** Tek context tüm route'larda banner; suppression ile tekrar göstermeme; takeaway sipariş prefill.
**Zayıf yan:**
- Polling ile çalışıyor (Socket emit yok → recent endpoint'i polling).
- Çoklu kasiyer senaryosu → herkes aynı popup'ı görür, yarış: önce tıklayan açar, diğerleri "Siparişi Aç"a tıklarsa **iki sipariş açılma riski** (`Doğrulanmamış` — call_log_id unique constraint var mı kontrol edilmedi).
- Global banner tüm rotaları kaplar — kasiyer mutfak ekranındayken bile görür.

---

## 5. Birleşim Akışı (Sequence)

```
[CIDShow → cid.dll EVENT]
        ↓ (NormalizeDigits, debounce 4000ms client-side)
[CallerIdSdkHelper.exe — POST]
        ↓ X-Bridge-Token, body {phone, source_type, raw_payload}
[Express: /api/bridge/caller-id/incoming]  ← bridgeAuth
        ↓
[processIncomingCall()]
   ├─ normalizePhoneDigits → "05xxxxxxxxx"
   ├─ DEDUPE 5sn (business_id + phone + source_type + status='ringing')
   ├─ findCustomerPhoneRow → customer | null
   ├─ INSERT call_logs (status='ringing', snapshot fields)
   ├─ auditLog('incoming_call')
   └─ INSERT incoming_calls (legacy, best-effort)
        ↓ HTTP 200 {callId, customer, displayPhone, matched, ...}

[Frontend: IncomingCallContext]
   ├─ POLLING: GET /caller-id/recent?limit=40 (her N sn)
   ├─ Yeni 'ringing' satırı + suppress'te değilse → bannerCall set
   └─ Banner UI (üst-orta, "Kapat" + "Siparişi Aç")

[Kasiyer "Siparişi Aç" tıklar]
   ├─ suppress sete ekle
   ├─ customer detay fetch (varsa) | snapshot construct (yoksa)
   ├─ PATCH /caller-id/logs/:id/status → opened_order
   └─ navigate(/order/takeaway, {customer, prefillPhone, callLogId})

[TakeawayOrderScreen]
   └─ callLogId state'te tutulur; sipariş kaydında muhtemelen
      linkCallLogToOrder(callLogId, orderId) çağrılır
      (callerIdService.js'te helper var; çağıran tarafı `Doğrulanmamış`)
```

---

## 6. v5 İçin Öneriler

### 6A. Davranış olarak aynen taşı
- **3 katmanlı veri:** `customers / customer_phones / customer_addresses` (multi-phone + multi-address gerçek ihtiyaç).
- **Kanonik telefon normalizasyonu** (`05xxxxxxxxx`) — `phoneNormalize` davranışı v5'te zod + util olarak yeniden yazılmalı (kod kopya yok).
- **call_logs status enum'u:** `ringing / dismissed / opened_order / completed`.
- **Server-side dedupe** (5sn → 8-10sn'ye çıkarılabilir; ADR'de tartış).
- **Snapshot pattern:** `customer_name_snapshot`, `address_snapshot` call_logs'ta — müşteri sonradan silinse/değiştirilse bile geçmiş okunabilir.
- **IncomingCallContext** UX modeli (üst-orta banner + suppression + "Siparişi Aç" → prefill takeaway).

### 6B. Yeniden tasarlanmalı
- **Pull → Push:** v5'te Socket.IO mevcut (ADR-002). `caller_id:incoming` event'i emit edilmeli, polling kaldırılmalı.
- **Bridge mimarisi:** Electron yok (CLAUDE.md). Caller ID helper **Print Agent gibi ayrı Windows servisi** olmalı (ADR-004 deseni). API base cloud (Hetzner) olacağı için latency göz önünde — local fallback `Doğrulanmamış` ihtiyaç.
- **Validation:** Manuel `cleanText` yerine zod schema (`packages/shared-types`).
- **`province/district/neighborhood`** ya tabloya eklenmeli ya da UI'dan tamamen kaldırılmalı (sessiz drop yasak).
- **Çoklu kasiyer popup:** Banner'ı hangi terminale göstereceğini seçen bir "delivery seat" konsepti olmalı. Açan kişi diğerlerinin banner'ını sunucu-side dismiss etmeli (yarış engeli).
- **Legacy `incoming_calls` tablosu** v5'te yok; sadece `call_logs`.
- **Clipboard listener'ı v5'e taşıma:** Önerilmiyor (clipboard kirliliği). Sadece SDK helper / TAPI / TCP cihaz protokolleri ile gidilmeli.
- **`is_blacklisted`** banner'da görünür (kırmızı uyarı).

### 6C. Migration ihtiyacı
- v3 SQLite → v5 Postgres data migration: bu MVP'de **dışarıda** (kullanıcı tek tenant kendisi, yeni başlangıç). Eski müşteri listesi CSV import ile getirilebilir (v3'te zaten CSV import var).

### 6D. KVKK / PII Kırmızı Bayrakları
- `call_logs` PII saklar (telefon + ad + adres snapshot). **Retention politikası MVP'de tanımlı değil** — v5'te ADR şart (öneri: 90 gün).
- `audit_logs` `incoming_call` event'inde telefon log'lar — KVKK aydınlatması gerekli.
- `raw_payload` (device_serial, line, vb.) saklanıyor mu? Backend `processIncomingCall` parametresinde alıyor ama `INSERT call_logs` cümlesinde **yok** — drop ediliyor. v5'te de droplamak en temiz yol (KVKK minimization).
- BRIDGE_TOKEN düz metin `pos-config.json` → v5'te env var + secret manager.
- `bridgeAuth` rate limit bu pass'ta görülmedi (`Doğrulanmamış`) — DDoS / brute-force riski.

### 6E. i18n Key Önerileri (v5)
| Key | TR |
|---|---|
| `customer.title` | Müşteri |
| `customer.search.placeholder` | Telefon veya isim ara |
| `customer.new` | Yeni Müşteri |
| `customer.phone` / `customer.phone2` | Telefon / 2. Telefon |
| `customer.address.default` | Varsayılan adres |
| `customer.blacklist.warning` | DİKKAT: Bu müşteri kara listede |
| `callerId.banner.title` | Gelen Arama |
| `callerId.banner.openOrder` | Siparişi Aç |
| `callerId.banner.dismiss` | Kapat |
| `callerId.history.title` | Arama Geçmişi |
| `callerId.status.ringing` | Çalıyor |
| `callerId.status.dismissed` | Kapatıldı |
| `callerId.status.openedOrder` | Siparişe Dönüştü |
| `callerId.status.completed` | Tamamlandı |

### 6F. Açık Sorular (Kullanıcıya)
1. **Donanım:** v5'te hangi caller-ID cihazı(ları) kullanılacak? CIDShow `cid.dll` mi, yoksa farklı (TAPI / TCP-IP / RJ11 modem AT)? Cihaz seçimi bridge mimarisini belirler.
2. **Bridge konumu:** Caller-ID bridge **Print Agent ile aynı Windows servisinde** mi koşacak, ayrı mı? (Restoranda zaten 1 PC + Print Agent var.)
3. **Çoklu terminal:** Birden fazla kasiyer ekranı varsa banner herkese mi düşsün, yoksa "delivery terminal" rolüne mi? (v3'te herkese düşüyor, yarış riski var.)
4. **call_logs retention:** KVKK gereği kaç gün saklanacak? Otomatik temizleme job'u olmalı mı?
5. **Sabit hat dedupe:** Sabit hat numaralarında `+90 212` ile `0212` aynı müşteri mi? (v3 normalizasyonu sabit hatları aynen tutuyor → potansiyel duplicate.)
6. **v3 müşteri import:** Açılışta v3 SQLite'tan kaç bin müşteri import edilecek? CSV mi, doğrudan migration mı?
7. **Blacklist UX:** `is_blacklisted=1` müşteri için banner ne yapsın — sadece uyarı mı, yoksa "Siparişi Aç" disabled mı?

---

## 7. Dosya Referansları (özet)

| Konu | Yol |
|---|---|
| PS clipboard listener | `D:\dev\restoran-pos-v3\scripts\callerid-clipboard-listener.ps1` |
| Bat başlatıcılar | `D:\dev\restoran-pos-v3\scripts\start-callerid-{clipboard,helper}.bat` |
| .NET SDK Helper | `D:\dev\restoran-pos-v3\tools\callerid-sdk-helper\` |
| Electron lifecycle | `D:\dev\restoran-pos-v3\electron\modules\callerIdProcess.cjs` |
| Backend route (cihaz) | `D:\dev\restoran-pos-v3\server\routes\bridge.js` (`POST /caller-id/incoming` bloğu) |
| Backend route (UI) | `D:\dev\restoran-pos-v3\server\routes\callerid.js` |
| Servis | `D:\dev\restoran-pos-v3\server\services\callerIdService.js` |
| Phone util | `D:\dev\restoran-pos-v3\server\utils\phoneNormalize.js` |
| Customers route | `D:\dev\restoran-pos-v3\server\routes\customers.js` |
| Schema | `D:\dev\restoran-pos-v3\server\migrations\run.js:168` (customers), `:855` (call_logs) |
| Frontend popup | `D:\dev\restoran-pos-v3\client\src\context\IncomingCallContext.jsx` |
| Caller-ID admin ekran | `D:\dev\restoran-pos-v3\client\src\components\callerid\CallerIdScreen.jsx` |
| Müşteri ekranı | `D:\dev\restoran-pos-v3\client\src\components\customers\CustomersScreen.jsx` |
| Sipariş içi modal | `D:\dev\restoran-pos-v3\client\src\components\orders\CustomerDetailsModal.jsx` |
| Frontend api client | `D:\dev\restoran-pos-v3\client\src\services\api\callerid.js` |
| Pos config | `D:\dev\restoran-pos-v3\pos-config.example.json` |

---

**Son not:** Bu rapor v5 PR-8 ADR'sine girdi sağlamak içindir. Karar (cihaz seçimi, push/pull, çoklu terminal stratejisi, retention) kullanıcıya bırakılmıştır.
