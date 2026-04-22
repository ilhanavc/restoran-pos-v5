# v3 Yazıcı Notları (Domain Referansı)

> Bu dosya v3 yazıcı davranışını v5 Print Agent mimarisine taşımak için **domain bilgisi** içerir. Kod kopyalama yok — yalnız byte protokolü, iş mantığı, vaka notları. v5'te ADR-004 "Print Agent Mimarisi" buradan beslenir.

## Mimari Değişiklik

v3: Electron içinde StoreBridge (ölü kod, karmaşık) → yazıcı.
v5: **Cloud API → print_job_queue → Print Agent (Windows servisi, restoran PC'si) → ESC/POS**.

- Template cloud tarafında render edilir (HTML değil, ESC/POS byte stream).
- Agent yalnız byte stream alır ve yazıcıya basar.
- Agent aynı zamanda **Caller ID forwarder** (Sinyal #18): TAPI/modem → cloud push (tek servis, ayrı process yok).

## ESC/POS Protokol Temelleri

### Preamble (her baskı öncesi zorunlu, Sinyal #28)

```
ESC @         (1B 40)    → printer reset
ESC t 13      (1B 74 0D) → codepage select CP857 (Türkçe)
```

**Neden zorunlu:** Yazıcı açılışta PC437 default'undadır. Preamble gönderilmezse "ğüşıçö" karakterleri bozulur. v3'te sporadik olarak "şef" → "?ef" görülen kaynaklı buydu.

### CP857 Encoding

- Kaynak: UTF-8 (DB ve cloud)
- Hedef: CP857 (yazıcı)
- v3'te `encodePC857()` byte tablo fonksiyonu vardı — v5'te tek encoder katman: `packages/shared-domain/printer/encode-cp857.ts`.
- Türkçe karakter tablosu (decimal):
  - ç=135, ü=129, ö=148, ş=159, ı=141, ğ=166, İ=152, Ş=158, Ğ=165
- Diğer karakterler standart ASCII (< 128) bir-bire-bir geçer.

### Yaygın Komutlar

```
ESC !  n    Print mode   (font, bold, double-height)
ESC a  n    Align        (0=left, 1=center, 2=right)
GS  V  m    Cut paper    (66 0 = full cut; 66 1 = partial)
ESC d  n    Feed lines
ESC p 0 n1 n2   Open cash drawer
```

(Tam liste v5 encoder modülünde; burada yalnız referans.)

## 4 Job Tipi (v5 parite)

| Tip | Nerede basılır | Tetik | İçerik |
|---|---|---|---|
| `receipt` | Kasa yazıcısı | Ödeme sonrası / adisyon isteği | Masa no, kalemler, toplam, ödeme tipi, zaman |
| `kitchen` | Mutfak/bar yazıcısı | Kalem KDS'ye gönderilince | Kalem adı, porsiyon, not, masa no, garson, sipariş no |
| `kitchen_adjustment` | Mutfak/bar yazıcısı | Hazırlanmış kalem iptal/azaltma | Kırmızı "İPTAL" / "AZALTILDI" başlık, before/after snapshot, neden (Sinyal #22) |
| `label` | Etiket yazıcısı (opsiyonel) | Paket siparişi hazır | Müşteri adı (anonim option), adres, telefon son 4, sipariş no |

**Kitchen adjustment (Sinyal #22):** ayrı fiş, ana kitchen fişinden ayrılmış. Aşçı bakışta fark etsin.

## Routing (Sinyal #8)

- **Kategori bazlı routing tek mekanizma**. Her kategori → hangi yazıcıya (0-N).
- Ürün seviyesi override **v5.1'e**.
- `categories.printer_ids[]` array veya `category_printer_routes` junction (ADR karar).
- Runtime yeniden yapılandırılabilir: admin UI üzerinden kategori ↔ yazıcı atanır, yeniden başlatma yok.

## Yazıcı Sayısı Runtime Değişken (Sinyal #27)

- v3'te hardcode ve config file tarafından belirleniyordu — yeni yazıcı eklemek yeniden başlatma istiyordu.
- v5: `printers` tablosu admin CRUD. Tipi (`receipt`, `kitchen`, `bar`, `label`), bağlantı (USB/network IP:port), kağıt genişliği (58/80mm), durum (`active`/`disabled`).
- Print Agent başlangıçta cloud'dan printer listesi çeker, connection open eder, disconnect'te retry.

## Timeout ve Retry (Sinyal #26)

```
Attempt 1 → timeout 20 sn
  fail → bekleme 5 sn
Attempt 2 → timeout 20 sn
  fail → bekleme 15 sn
Attempt 3 → timeout 20 sn
  fail → kasa toast bildirimi + ses uyarısı
```

- Kasiyer ANINDA uyarılır (sessiz başarısızlık yasak).
- Toast'a aksiyon: "Tekrar dene" / "İptal".
- Retry sırasında yeni job'lar queue'da birikir, agent tek yazıcıyı block etmez (başka yazıcıya yönlenenler paralel devam).

## Idempotency (Sinyal, kritik)

- Her print job'un `idempotency_key` UNIQUE.
- Network retransmit / agent crash sonrası restart durumunda **çift basım sıfır**.
- Anahtar formatı: `{tenant_id}:{order_id}:{job_type}:{job_seq}` veya UUID v7.

## v3'te Gözlemlenen Ağrılar (v5'te kaçınılacak)

- **StoreBridge karmaşık + ölü**: Electron renderer → main → COM port → ESC/POS. Debug imkansız. v5: doğrudan Node.js service, tek süreç.
- **CP857 preamble unutulması**: sporadik bozuk karakter. v5: encoder **her zaman** preamble gönderir, opsiyon değil.
- **Çift basım**: kasiyer iki kez tıkladığında fiş iki kere çıkıyordu. v5: idempotency_key UNIQUE + UI optimistic lock.
- **Sessiz başarısızlık**: yazıcı kapalı/kağıtsız → kasiyer fark etmeden servis devam. v5: 3 deneme sonrası toast + ses.
- **Yazıcı değişimi = redeploy**: yeni yazıcı config'e ekleyip restart. v5: admin UI + runtime tespit.

## Caller ID Entegrasyonu (Sinyal #18, #19)

Print Agent aynı process içinde:
- TAPI / modem / IP santral event dinler
- Gelen numara → cloud API `POST /calls/incoming` (Socket.IO ile kasaya push)
- Kasaya 2-3 sn içinde popup: müşteri var mı (`customer_phones.normalized_phone` lookup), geçmiş siparişler, son adres

**v3 ağrısı:** 2-3 sn gecikme vardı (polling). v5: Socket.IO realtime push.

## v5 ADR Ön-notları

ADR-004 yazılırken kapsayacak:
1. Job schema (`print_jobs` tablosu: id, tenant_id, printer_id, job_type, payload_bytes, status, attempts, idempotency_key, enqueued_at, printed_at)
2. Queue pull vs push (Agent pull recommended — cloud tetik yok, firewall dostu)
3. Encoder konumu (cloud'da render önerilir — template versiyonlama kolay)
4. Offline davranış (v5.0 scope dışı; Agent online varsayılır, v5.2+ queue persistence)
5. Caller ID push kanalı (Socket.IO room: `tenant:{id}:calls`)
