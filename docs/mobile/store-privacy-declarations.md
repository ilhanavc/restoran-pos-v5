# Mağaza Gizlilik / Veri Güvenliği Beyanları — Cevap Tablosu

> **Dayanak:** ADR-031 Amendment 4 K9 (`.claude/memory/decisions.md`).
> **Türetme kaynağı:** `docs/compliance/kvkk-data-inventory.md` — beyanlar **uydurulmaz**, envanterden türetilir. Envanterle bu tablo çelişirse **envanter güncellenir**, beyan değiştirilmez.
> **Kapsam:** yalnız `apps/mobile` (Restoran POS Garson, `com.restoranpos.garson`).
> **Uyarı:** Yanlış beyan mağazadan kaldırma sebebidir. [USER] konsola girmeden önce bu tabloyu okur.

---

## 0. Beş temel cevap (her iki mağaza için ortak)

| Soru | Cevap | Kaynak |
|---|---|---|
| Üçüncü taraflarla veri paylaşımı var mı? | **HAYIR** — veri yalnız işletmenin kendi sunucusuna gider | envanter §2, §6 |
| Reklam / üçüncü taraf analitik / izleme (tracking) var mı? | **HAYIR** | ADR-031 Amd4 K9 |
| Uygulama içi satın alma var mı? | **HAYIR** | — |
| Veri aktarım sırasında şifreleniyor mu? | **EVET** — HTTPS/TLS (Let's Encrypt) | envanter §9 |
| Kullanıcı veri silinmesini talep edebiliyor mu? | **EVET** — gizlilik politikasındaki e-posta ile | envanter §5, §8 |

**Barındırma:** Hetzner Online GmbH, Falkenstein / **Almanya**. Yedekler age ile şifreli, yine Almanya (envanter §2, §6).

---

## 1. Apple — App Store Connect "App Privacy"

Apple her veri türü için üç soruyu sorar: **toplanıyor mu?** → **kullanım amacı?** → **kullanıcı kimliğine bağlı mı (Linked)?** → **izleme (Tracking) için mi?**

**"Tracking" cevabı TÜM türler için HAYIR.** (Uygulama başka şirketlerin uygulama/sitelerinden gelen veriyle eşleştirme yapmaz, reklam ağına veri göndermez.)

| Apple veri kategorisi | Toplanıyor? | Alt tür | Amaç | Kimliğe bağlı? | Not / envanter kaynağı |
|---|---|---|---|---|---|
| **Contact Info → Name** | EVET | Ad | App Functionality | Evet (Linked) | Personel görünen adı + **işletme müşterisinin adı** (paket servis). `users.username`, `customers.full_name` — envanter §3 |
| **Contact Info → Email Address** | EVET | E-posta | App Functionality | Evet (Linked) | Personel girişi e-posta ile yapılır. `users.email` — envanter §3 |
| **Contact Info → Phone Number** | EVET | Telefon | App Functionality | Evet (Linked) | **İşletme müşterisinin** telefonu (paket servis / Caller ID). `customer_phones`, `call_logs` — envanter §3 |
| **Contact Info → Physical Address** | EVET | Adres | App Functionality | Evet (Linked) | Paket servis teslimat adresi. `customer_addresses`, `orders.delivery_address_snapshot` — envanter §3 |
| **User Content → Other User Content** | EVET | Sipariş notu | App Functionality | Evet (Linked) | `orders.note`, ürün notu — serbest metin |
| **Identifiers → User ID** | EVET | Hesap kimliği | App Functionality | Evet (Linked) | Personel kullanıcı UUID'si; sipariş atfı |
| **Usage Data → Product Interaction** | EVET | Uygulama içi aktivite | App Functionality | Evet (Linked) | Sipariş/adisyon işlemleri + denetim kaydı. `audit_logs` — envanter §3 |
| **Diagnostics → Crash / Performance / Other Diagnostic Data** | EVET | Teknik log | App Functionality | Evet (Linked) | Sunucu tarafı hata/oturum log'u, IP + cihaz bilgisi (`refresh_tokens.ip_address`, `user_agent`) — envanter §3 |
| Financial Info (kart/banka) | HAYIR | — | — | — | Kart verisi işlenmez; ödeme yalnız "nakit/kart" **etiketi** ve tutar olarak kaydedilir, kart numarası hiç girilmez |
| Location (Precise/Coarse) | HAYIR | — | — | — | Konum izni istenmez |
| Health & Fitness | HAYIR | — | — | — | — |
| Browsing History | HAYIR | — | — | — | — |
| Search History | HAYIR | — | — | — | — |
| Contacts (rehber) | HAYIR | — | — | — | Cihaz rehberine erişilmez |
| Sensitive Info | HAYIR | — | — | — | Özel nitelikli veri işlenmez — envanter §3 negatif teyit |
| Purchases | HAYIR | — | — | — | IAP yok |
| Identifiers → Device ID | HAYIR | — | — | — | Reklam kimliği (IDFA) kullanılmaz |

**Amaç sütununda YALNIZ "App Functionality" seçilir.** "Analytics", "Product Personalization", "Developer's Advertising or Marketing", "Third-Party Advertising" hiçbir tür için işaretlenmez.

**App Tracking Transparency (ATT):** Uygulama izleme yapmadığı için `NSUserTrackingUsageDescription` ve ATT izin akışı **gerekmez**; eklenmemiştir.

**Export compliance:** `ITSAppUsesNonExemptEncryption: false` `app.json`'da mevcuttur (yalnız standart HTTPS kullanılır) — bu soru otomatik yanıtlanır.

---

## 2. Google — Play Console "Data safety"

Play üç soru sorar: **toplanıyor mu (collected)?** → **paylaşılıyor mu (shared)?** → **zorunlu mu / opsiyonel mi?** ve ayrıca amaç seçimi ister.

**"Shared" TÜM türler için HAYIR** (Play tanımında "shared" = üçüncü bir tarafa aktarım; kendi sunucumuza gönderim "collected" sayılır, "shared" sayılmaz).

| Play veri türü | Collected | Shared | Zorunlu mu | Amaç | Not |
|---|---|---|---|---|---|
| Personal info → Name | EVET | HAYIR | Zorunlu | App functionality | Personel adı + müşteri adı |
| Personal info → Email address | EVET | HAYIR | Zorunlu | App functionality, Account management | Personel girişi |
| Personal info → Phone number | EVET | HAYIR | Zorunlu | App functionality | Müşteri telefonu (paket servis) |
| Personal info → Address | EVET | HAYIR | Zorunlu | App functionality | Teslimat adresi |
| Personal info → User IDs | EVET | HAYIR | Zorunlu | App functionality, Account management | Personel hesap kimliği |
| App activity → App interactions | EVET | HAYIR | Zorunlu | App functionality | Sipariş/adisyon işlemleri |
| App activity → Other user-generated content | EVET | HAYIR | Opsiyonel | App functionality | Sipariş/ürün notu |
| App info and performance → Crash logs | EVET | HAYIR | Zorunlu | App functionality | Hata kayıtları |
| App info and performance → Diagnostics | EVET | HAYIR | Zorunlu | App functionality | Oturum/IP/cihaz bilgisi |
| Financial info | HAYIR | HAYIR | — | — | Kart/banka verisi işlenmez |
| Location | HAYIR | HAYIR | — | — | Konum izni yok |
| Health and fitness | HAYIR | HAYIR | — | — | — |
| Messages / Photos and videos / Audio files / Files and docs | HAYIR | HAYIR | — | — | — |
| Contacts | HAYIR | HAYIR | — | — | Rehber erişimi yok |
| Calendar | HAYIR | HAYIR | — | — | — |
| Device or other IDs | HAYIR | HAYIR | — | — | Reklam kimliği kullanılmaz |

**Play güvenlik uygulamaları bölümü:**

| Soru | Cevap | Gerekçe |
|---|---|---|
| Veri aktarımda şifreleniyor mu? | **EVET** | HTTPS/TLS — envanter §9 |
| Kullanıcı verisinin silinmesini talep edebiliyor mu? | **EVET** | Gizlilik politikasındaki e-posta üzerinden (envanter §5 manuel imha prosedürü) |
| Play Families politikasına tabi mi? | **HAYIR** | Uygulama çocuklara yönelik değil |
| Bağımsız güvenlik denetiminden geçti mi? | **HAYIR** | Üçüncü taraf denetim yapılmadı — dürüst cevap |

**Play "App access":** Uygulamanın tamamı giriş gerektirir → "All or some functionality is restricted" seçilir ve K8 demo garson hesabının kimlik bilgisi girilir (repoya YAZILMAZ).

**Ads:** "Bu uygulama reklam içeriyor mu?" → **HAYIR.**

---

## 3. Bilinçli beyan kararları (denetim izi)

1. **Müşteri verisi "Contact Info" olarak beyan edilir.** Veri uygulamayı indiren kişiye değil, restoranın müşterisine aittir; ancak her iki mağaza da "toplanan kişisel veri" tanımını veri sahibine göre daraltmaz → tam beyan yapılır (ADR-031 Amd4 K9).
2. **Tüm türler "Linked to the user".** Personel hesabı üzerinden işlem yapıldığı ve denetim kaydı tutulduğu için anonim/ayrık (Not Linked) beyanı yanlış olurdu.
3. **"Tracking" her yerde HAYIR.** Envanterde üçüncü taraf reklam/analitik SDK'sı yoktur; uygulama yalnız kendi API'siyle konuşur.
4. **Financial info HAYIR.** Ödeme tutarı ve yöntemi (nakit/kart etiketi) kaydedilir; **kart numarası, banka bilgisi veya ödeme aracı verisi hiç girilmez/işlenmez** — envanter §3'te böyle bir kolon yoktur.
5. **Diagnostics EVET.** IP ve cihaz/tarayıcı bilgisi oturum güvenliği için saklanır (`refresh_tokens`) — envanter §3 bunu açıkça PII sayar, gizlemek yanlış beyan olurdu.

---

## 4. Envanterle çelişki kontrolü (bu tablo güncellenirken tekrar yapılır)

- [ ] Envanter §3'teki her PII kolonu bu tabloda bir mağaza türüne eşlendi.
- [ ] Envanter §5 saklama süreleri gizlilik politikası sayfasındaki (`/privacy` §7) sürelerle aynı.
- [ ] Envanter §6 (Almanya/yurt dışı aktarım) gizlilik politikasında yazılı.
- [ ] Envanter §9'da "YOK" işaretli tedbirler (kolon şifreleme, IP anonimleştirme) mağaza formunda **var gibi beyan edilmedi**.
- [ ] Yeni bir üçüncü taraf SDK eklenirse (analitik, crash reporting, push sağlayıcı) bu tablo ve envanter birlikte güncellenir.

> **Not:** Expo/EAS Update (OTA) uygulama paketinin kendisini günceller; kullanıcı kişisel verisi Expo sunucularına gönderilmez. Bu nedenle "veri paylaşımı" beyanını değiştirmez.
