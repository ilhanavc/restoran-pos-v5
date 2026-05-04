# POS Restoran Caller ID Entegrasyonu — Dünya Pratikleri

> **Amaç:** Restoran POS v5 (delivery + masa servisli, Türkiye, başta tek tenant) için Caller ID mimari kararına girdi.
> **Yöntem:** WebSearch + dokümantasyon taraması, v3 davranış analizi (`docs/v3-reference/caller-id-and-customer.md`) ile karşılaştırma.
> **Tarih:** 2026-05-03.
> **Kapsam dışı:** Spekülatif "yapay zeka voice ordering" (Domino's "Dom"), AI tabanlı çağrı yanıtlama — v5.1+ backlog.

---

## Yönetici Özeti

Dünya pratiğinde restoran Caller ID üç katmanda çözülüyor: (1) **donanım yakalama** (USB seri, Ethernet RJ45, ya da SIP/VoIP webhook), (2) **bridge servisi** (cihazdan POS backend'e HTTP/TCP), (3) **frontend push** (WebSocket/Socket.IO). Toast POS, Aldelo ve Heartland gibi büyük oyuncular **Whozz Calling Ethernet** veya **Vertex VoIP** modemini standart kabul ediyor; açık kaynak dünyası **NCID daemon** (TCP 3333, ASCII protokol) etrafında konsolide olmuş; yeni nesil bulut POS'lar **Twilio Voice webhook** ile telefon hattını tamamen bypass ediyor.

**Türkiye için en uygun mimari:** v3'te kanıtlanmış olan **CIDShow `cid.dll` SDK + lokal bridge servisi (Print Agent içine modül) + Socket.IO push**. Bu mimari `~₺1.500-3.500` donanım maliyeti, KVKK-uyumlu lokal işleme, multi-station broadcast desteği ve cloud bağımlılığı olmadan offline-tolerant çalışma sunar. v3'teki **polling** yerine v5'te **server-side push** (Socket.IO `caller_id:incoming` event) ve **server-side claim** (yarış engeli) zorunlu eklemelerdir.

---

## 1. Donanım Stratejisi

| Yaklaşım | Cihaz örneği | Bağlantı | Artı | Eksi | Maliyet (TR) | Türkiye'de uygun mu? |
|---|---|---|---|---|---|---|
| **USB seri (PSTN)** | CIDShow C812A/C814A | USB → 2/4 hat RJ11 | Tek PC, sürücüsüz, ucuz, yerli üretim | Tek PC'ye bağlı, lokal SDK gerekli | ~₺1.500-2.500 | ✅ Pazar standardı |
| **Ethernet (PSTN)** | Whozz Calling Deluxe Ethernet | RJ45 → 2/4/8 hat RJ11 | Multi-station native, PC bağımsız | Pahalı, 110V US adaptör problemi | ~$300-500 + import | ⚠️ Az kullanılıyor |
| **VoIP/SIP modem** | Whozz Calling Vertex | Ethernet, SIP packet sniffer | VoIP hatlarda çalışır, output Whozz analog ile uyumlu | SIP signaling şifresiz olmalı, KVKK riski | ~$400+ | ⚠️ TR'de PSTN hala yaygın |
| **Cloud SIP (Twilio Voice)** | Twilio number + webhook | Internet + HTTPS | Donanım yok, E.164 native, lookup API | Aylık abonelik, KVKK riski (US-merkezli), gecikme | ~$10/ay + per-call | ❌ KVKK + numara taşıma sorunu |
| **PBX entegrasyon (Asterisk/FreePBX)** | AMI/ARI hook | TCP soket / WebSocket | Kurumsal, çoklu hat, çoklu lokasyon | PBX kurulumu gerekli, overkill | Self-hosted | ❌ Tek restoran için aşırı |

**Kaynaklar:**
- [Whozz Calling Deluxe Ethernet](https://nurolpos.com/whozz-calling-deluxe-ethernet-caller-id-modem/) — Domino's resmi tercih (eriş. 2026-05-03)
- [Toast Caller ID hardware](https://central.toasttab.com/s/article/Caller-ID-1492794310341) — Vertex (VoIP) + Whozz (analog) (eriş. 2026-05-03)
- [CIDShow C812A — POS Start](https://www.barkodlusistem.com/urun/caller-id-cihazi-2-hatli-c812a) (eriş. 2026-05-03)
- [Adisyo Caller ID — CID602/CID812A onaylı](https://infoset.help/kpknnzhmbumkekrk/tr/articles/2192-musteri-tanima-sistemi-caller-id-entegrasyonu) (eriş. 2026-05-03)

---

## 2. Bridge Mimarisi (donanım ↔ POS backend)

### Pattern A: Local daemon + HTTP push (en yaygın)
```
[Donanım] → [Local bridge servisi] → HTTP POST → [POS backend API]
                                         (X-Bridge-Token auth)
```
- **Toast POS** Vertex Configuration Tool çalıştırıp Caller ID'yi Ethernet üzerinden topluyor; daha sonra bulut backend'e iletiyor.
- **v3 davranışı (referans):** `CallerIdSdkHelper.exe` (.NET 8 console) → `POST /api/bridge/caller-id/incoming`. Kanıtlanmış desen.
- **Artı:** Loose coupling, backend sürümleme kolay, retry logic local'de.
- **Eksi:** Backend down ise event kaybı (lokal queue gerekli).

### Pattern B: Local daemon + WebSocket (real-time hassas)
- **NCID** modeli: `ncidd` (port 3333) modemi okur, ASCII protokol ile bağlı tüm istemcilere broadcast yapar.
- **Asterisk ARI:** REST + WebSocket; JSON event'leri push.
- **Artı:** Multi-listener native, backend latency yok.
- **Eksi:** Connection state yönetimi karmaşık; restoran network'ünde NAT/firewall sorunları.

### Pattern C: TAPI direkt entegrasyon (legacy Windows)
- Microsoft TAPI 2/3 üzerinden POS app modemi direkt dinler.
- **Eksi:** TAPI deprecated, çoklu cihaz desteği zayıf, Windows-only, backend'e ulaşmak için extra köprü gerekli.
- **Sonuç:** v5 için önerilmez.

### Pattern D: Cloud SIP webhook (donanımsız)
- Twilio Voice number → webhook → backend `POST /caller-id/incoming` (`From: +905XX...` E.164).
- **Artı:** Sıfır donanım, multi-tenant native, lookup API ile carrier+name bilgisi.
- **Eksi:** Numara taşıma operasyonel zorluk (TR'de Twilio numarası yok); KVKK için veri yurtdışı transferi onay gerektirir.

---

## 3. Backend → Frontend Push Stratejisi

| Yöntem | Latency | Kompleksite | v3 kullanıyor mu? | Önerilen v5 |
|---|---|---|---|---|
| **HTTP polling** (`GET /caller-id/recent` her 3-5sn) | 2-5 sn | Düşük | ✅ — şu an bu | ❌ |
| **Long-polling** | <1 sn | Orta | ❌ | ❌ |
| **Server-Sent Events (SSE)** | <1 sn | Orta (proxy sorunları) | ❌ | ⚠️ Fallback |
| **WebSocket (Socket.IO)** | <500 ms | Orta-yüksek | Mevcut altyapıda var | ✅ **Birincil** |

**Dünya pratiği:**
- **Heartland Restaurant:** native WebSocket; tüm cihazlara push.
- **Toast:** kapalı kaynak, dokümantasyondan WebSocket çıkarımı.
- **NCID:** TCP soket üzerinden plaintext broadcast.

**v5 öneri:** `caller_id:incoming` Socket.IO event'i, room = `tenant:${tenantId}`. Polling fallback opsiyonel.

---

## 4. Multi-Station UX Patterns

Tek caller-id cihazı + N kasiyer ekranı senaryosunda 4 ana desen:

| Desen | Davranış | Kullanan | Yarış riski |
|---|---|---|---|
| **Broadcast all** | Tüm istasyonlarda popup | v3 (mevcut), Heartland Restaurant, SambaPOS | ✅ Var — iki kasiyer aynı anda "Aç" tıklar → 2 sipariş |
| **Sticky to station** | Tanımlı "delivery terminal"a düşer | Aldelo (config), AmigoPOS | ❌ Yok ama esnek değil |
| **Queue + manual claim** | Liste, kim claim ederse onun popup'ı | Lightspeed delivery modülü | ❌ Yok, güvenli |
| **Round-robin assign** | Sırayla kasiyere atan | Custom enterprise | ❌ Yok |

**v3 zayıflığı:** Broadcast all + suppression sadece per-user (sessionStorage) → server-side claim yok. v5'te `PATCH /call-logs/:id/claim` (atomic, `claimed_by` NULL ise UPDATE) eklenmesi şart. Claim alınınca diğer istasyonlara `caller_id:claimed` event ile banner kapatılır.

**Kaynak:** [SambaPOS broadcast forum](https://forum.sambapos.com/t/how-to-broadcast-caller-id-popups-to-other-terminals/1625), [Heartland Restaurant — all devices receive CID](https://www.jcrsystems.com/heartlandrestaurant-callerid/) (eriş. 2026-05-03).

---

## 5. Müşteri Lookup + Otomatik Form Doldurma

Standart akış (Toast/Adisyo/v3 ortak):

```
[Çağrı] → normalize phone → DB lookup (customer_phones.normalized_phone)
   ├─ MATCH → popup: ad, son sipariş özeti, varsayılan adres, "Siparişi Aç"
   └─ NO MATCH → popup: numara + "Yeni Müşteri" → form prefill (phone)
```

**Ekran düşen veri (best practices):**
- Müşteri adı + telefon (büyük font, Fitts)
- Default address (delivery için kritik)
- Son 3 sipariş özet (Toast'ta var)
- Black-list uyarısı (v3'te `is_blacklisted` var ama UI'da görünmüyor — v5'te kırmızı banner)
- Toplam sipariş sayısı + ortalama ticket (Toast)

**v3'te eksik (v5'te eklenmeli):** Son sipariş özeti popup'ta. Şu an sadece ad+adres geliyor.

---

## 6. Privacy / KVKK / GDPR

| Konu | Toast (US, GDPR-aware) | v3 mevcut | v5 öneri |
|---|---|---|---|
| **Çağrı log retention** | Tanımsız (CRM'e gömülü) | Tanımsız | **90 gün** (ADR) sonra anonimize |
| **Bilinmeyen numara** | Saklanır | Saklanır (`customer_id=NULL`) | 30 gün sonra silinir |
| **Opt-out** | Customer profile flag | ❌ Yok | `customer.consent_recorded_at` + UI toggle |
| **Audit log telefon** | Hashed in some markets | Plaintext | SHA-256 + last4 plain |
| **raw_payload (device_serial vs.)** | Saklanmaz | Drop ediliyor (iyi) | Drop edilmeli |

**KVKK özel:** Türkiye'de [VERBİS kayıt zorunluluğu](https://www.cookieyes.com/blog/turkey-data-protection-law-kvkk/) ve "Personal Data Retention and Destruction Policy" şart. Restoran müşteri telefonu = kişisel veri → aydınlatma metni + retention politikası ADR-gerekli.

**Kaynak:** [Turkey KVKK and the GDPR — TermsFeed](https://www.termsfeed.com/blog/turkey-kvkk-gdpr/) (eriş. 2026-05-03).

---

## 7. Türkiye Özel Notlar

- **CIDShow C812A/C814A** pazar standardı. Adisyo, Bilnex, Simpra, MeliPOS, IxirPOS hep bu cihazı destekliyor. `cid.dll` SDK x86/x64 birlikte gelir.
- **Türk Telekom CLIP** servisi: sabit hatta caller ID için **abonelik + aylık ücret** gerekli. Müşteri restoran sahibi tarafından ayrı satın alınmalı (POS scope'u dışında, doc'a not).
- **Numara normalize:** TR formatları → kanonik `0` + 10 hane:
  - `+90 5xx xxx xxxx` (12 hane) → `05xxxxxxxxx`
  - `5xx xxx xxxx` (10 hane) → `05xxxxxxxxx`
  - `0212 xxx xxxx` (sabit) → aynen
- **Yemek platformları (Yemeksepeti/Getir/Trendyol Yemek):** Kendi numaraları üzerinden müşteriyi maskeleyerek arar (`08502...`). Bu numaralar caller ID'de yakalanırsa **müşteri eşlemesi yanlış olur**. v5'te platform numaraları için **bypass listesi** (env config) gerekli.
- **0850 / 0444 prefix'leri:** Kurumsal çağrı, restoran müşterisi olma ihtimali düşük → opsiyonel filtre.

---

## 8. ÖNERİ — v5 İçin En İyi 3 Mimari

### Mimari 1: **CIDShow SDK + Lokal Bridge (Print Agent modülü) + Socket.IO push** [ÖNERİLEN]

```
[CIDShow C812A USB]
    ↓ cid.dll event
[Print Agent (Windows servis)] ← v5'te ADR-004 ile zaten Windows servisi var
    ├─ debounce 4sn (lokal)
    ├─ POST /api/bridge/caller-id/incoming (X-Bridge-Token)
    └─ retry queue (backend down toleransı)
        ↓
[Express API]
    ├─ server-side dedupe 8sn
    ├─ customer lookup (normalized_phone)
    ├─ INSERT call_logs (status='ringing')
    └─ Socket.IO emit('caller_id:incoming', payload) → room=tenant:${tid}
        ↓
[React frontend (web + mobile)]
    ├─ IncomingCallContext → banner
    ├─ "Siparişi Aç" → PATCH /call-logs/:id/claim (atomic)
    └─ claim başarılı → navigate('/order/takeaway', {prefill})
        ↓
[Diğer istasyonlar] ← Socket.IO 'caller_id:claimed' event → banner hide
```

**Neden en iyi:**
- v3 mantığı kanıtlanmış (1+ yıl prod kullanım).
- Donanım maliyeti düşük (~₺1.500-2.500), Türkiye pazarında bol.
- KVKK için lokal işleme, cloud transfer yok.
- Print Agent zaten Windows servisi → ek deployment kompleksitesi yok.
- Polling → push migration v3'teki ana zayıflığı kapatır.
- Server-side claim ile multi-station yarış kapatılır.

**Effort:** **M** (orta). Print Agent'a CallerID modülü ekle, backend dedupe + Socket.IO emit ekle, frontend IncomingCallContext yeniden yaz.

**Riskler:**
- `cid.dll` SDK versiyon kırılması (v3'te de var, mitigation: SDK dosyalarını repo'da version-locked tut).
- Tek PC bağımlılığı (Print Agent down → Caller ID down). Mitigation: print-agent zaten kritik path'te.

---

### Mimari 2: **Whozz Ethernet + Direkt Backend TCP listener + Socket.IO push**

```
[Whozz Calling Deluxe Ethernet] → TCP RAW packets → [Express API TCP listener]
                                                          → Socket.IO emit
```

**Artı:**
- PC bağımsız (router'a bağlanır), 2-8 hat native.
- Print Agent'a bağımlı değil.
- Domino's pattern.

**Eksi:**
- Cihaz Türkiye'de pahalı + import (~$300-500 + KDV + kargo).
- 110V US adaptör → TR'de güç adaptörü değişimi.
- Backend'in TCP listener tutması cloud Express deployment'ında sorun (Hetzner reverse proxy + sticky port).
- Restoran ağı → Hetzner backend'e direkt TCP zor (NAT, firewall) → yine bir local bridge gerekli, avantaj kaybolur.

**Effort:** **L** (büyük). Yeni TCP protokol parser, deployment topology değişikliği.

---

### Mimari 3: **Twilio Voice webhook + Cloud bridge** [v5.1 backlog]

```
[Müşteri arar Twilio TR numarası] → Twilio webhook → POST /api/twilio/caller-id
                                                     → normalize → emit
```

**Artı:**
- Sıfır lokal donanım.
- Multi-tenant native, multi-lokasyon kolay.
- E.164 + Lookup API ile carrier+name bilgisi.
- Recording, analytics opsiyonel.

**Eksi:**
- TR'de Twilio numara availability sınırlı; numara taşıma (port-in) operasyonel maraton.
- Aylık abonelik + per-minute charge.
- KVKK: çağrı içeriği US-merkezli sunucudan geçerse veri yurtdışı transferi onay metni gerektirir.
- Müşterinin "salt arasın, sipariş versin" ihtiyacında müşteriyi yeni bir numarayı aramaya zorlamak adoption riski.

**Effort:** **S-M** (entegrasyon küçük) ama operasyonel **XL** (numara taşıma, KVKK, fatura).

**Verdict:** v5.0 dışı, v5.1+ multi-tenant olunca tekrar değerlendir.

---

## 9. Açık Sorular (Kullanıcıya Yöneltilecek)

1. **Donanım:** Şu an restoranda **CIDShow C812A** mı kurulu (v3 ile aynı)? Yeni cihaz alımı gerekiyor mu?
2. **Hat sayısı:** Tek hat yeterli mi, 2 hat mı? Sabit hat + cep paralel mi?
3. **Multi-station:** Gelecek 1 yıl içinde 2'den fazla kasiyer ekranı olacak mı? (Yarış engeli kritikliği bunu belirler.)
4. **call_logs retention:** 90 gün makul mü? Daha kısa/uzun?
5. **Yemeksepeti/Getir bypass:** Bu platformların aradığı maskeli numaralar (`08502...`) Caller ID'de yakalanıyor mu? Bu numaralar için filter list lazım mı?
6. **Blacklist UX:** `is_blacklisted=1` müşteri için banner: sadece kırmızı uyarı mı, yoksa "Siparişi Aç" disabled mı?
7. **Print Agent birlikte mi:** Caller ID bridge **Print Agent içinde modül** olarak mı (önerilen), ayrı Windows servisi mi?
8. **Sabit hat dedupe:** `+90 212 xxx xxxx` ile `0212 xxx xxxx` aynı müşteri sayılmalı mı? (E.164 kanonik geçişi gerekiyor mu?)

---

## 10. Sonuç ve Sonraki Adımlar

- **Önerilen mimari:** Mimari 1 (CIDShow SDK + Print Agent modülü + Socket.IO).
- **ADR aday başlıkları:**
  - ADR-015: Caller ID donanım seçimi ve bridge mimarisi
  - ADR-016: Caller ID retention ve KVKK politikası
  - ADR-017: Multi-station claim protokolü (server-side atomic)
- **v3'ten taşınacak davranış:** Schema (3 tablo), normalize util, snapshot pattern, status enum, IncomingCallContext UX modeli.
- **v3'ten taşınmayacak:** Polling, per-user-only suppression, clipboard listener, Electron lifecycle, legacy `incoming_calls` tablosu.

---

## Kaynaklar (erişim 2026-05-03)

- [Toast POS Caller ID — pos.toasttab.com](https://pos.toasttab.com/news/toast-pos-releases-integrated-caller-id-ordering)
- [Toast Caller ID Setup — central.toasttab.com](https://central.toasttab.com/s/article/Caller-ID-1492794310341)
- [Toast Vertex Caller ID Installation](https://support.toasttab.com/en/article/Vertex-Caller-ID-Installation-Guide)
- [Whozz Calling Deluxe Ethernet — nurolpos.com](https://nurolpos.com/whozz-calling-deluxe-ethernet-caller-id-modem/)
- [Whozz Calling Vertex VoIP — nurolpos.com](https://nurolpos.com/whozz-calling-vertex-voip-caller-id-modem/)
- [CallerID.com Basic POS Manual (PDF)](http://callerid.com/downloads/manuals/Basic_48.pdf)
- [NCID — Wikipedia](https://en.wikipedia.org/wiki/Network_Caller_ID)
- [NCID daemon man page — ncidd(8)](https://linux.die.net/man/8/ncidd)
- [NCID source — ncid.sourceforge.io](https://ncid.sourceforge.io/)
- [Twilio Voice Webhooks](https://www.twilio.com/docs/usage/webhooks/voice-webhooks)
- [Twilio Lookup API](https://www.twilio.com/en-us/user-authentication-identity/lookup)
- [Asterisk REST Interface (ARI)](https://docs.asterisk.org/Configuration/Interfaces/Asterisk-REST-Interface-ARI/)
- [Asterisk ARI vs AMI Community Discussion](https://community.asterisk.org/t/ari-or-ami-which-is-better-for-crm-integration/110470)
- [Domino's Pulse POS overview — Canopy](https://www.gocanopy.com/news-insights/dominos-pulse-pos-system)
- [Adisyo Caller ID kurulum](https://infoset.help/kpknnzhmbumkekrk/tr/articles/2192-musteri-tanima-sistemi-caller-id-entegrasyonu)
- [Bilnex Caller ID kurulum kılavuzu](https://bilgibankasi.bilnex.com.tr/bilgi-bankasi/caller-id-kurulumu-ve-restoran-paket-servis-ayarlari-nasil-yapilir/)
- [Heartland Restaurant Caller ID — JCR Systems](https://www.jcrsystems.com/heartlandrestaurant-callerid/)
- [Aldelo Caller ID — Brilliant POS](https://brilliantpos.com/caller-id/)
- [LingaROS Caller ID](https://www.lingaros.com/restaurant-operating-system/caller-id/)
- [SambaPOS broadcast forum](https://forum.sambapos.com/t/how-to-broadcast-caller-id-popups-to-other-terminals/1625)
- [AmigoPOS Caller ID Broadcast Config](http://www.amigopos.com/help7/html/caller_id_box.htm)
- [Turkey KVKK and the GDPR — TermsFeed](https://www.termsfeed.com/blog/turkey-kvkk-gdpr/)
- [Turkey KVKK Guide — CookieYes](https://www.cookieyes.com/blog/turkey-data-protection-law-kvkk/)
- [CIDShow C812A — sistemler.com](https://www.sistemler.com/siparis-sistemleri/c812a/)
