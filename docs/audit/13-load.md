# Blok 13 — Yük/stres harness sonuçları

> Derin denetim serisi Blok 13, B ayağı. **Tarih:** 2026-07-12 · **Branch:** `audit/13-synthesis` · **Model:** Fable 5 → Opus 4.8 (session devri).
> **Ortam:** YALNIZ LOKAL — lokal API (`localhost:3001`, tsx dev) + `pos_test` DB (head 044). **Prod/pos_dev'e HİÇBİR istek gitmedi** (`run-load.mjs` BASE_URL guard'ı localhost dışını reddeder). Harness: `load/run-load.mjs` (bağımlılık-yok, Node 22 fetch + saf percentile; autocannon npm kurulumu takıldığı için öz-yazım).

---

## 0. ⚠️ En önemli uyarı — sonuçlar VERİ-HACMİ açısından iyimser

`pos_test` neredeyse boş: **2 sipariş · 2 müşteri · 1 ödeme · 5 ürün · 6 masa.** Bu harness **API/pool/concurrency/rate-limit davranışını** ölçer; **gerçek üretim veri-hacmindeki sorgu performansını ÖLÇMEZ.** Reports agregasyon latency'si (p99=64ms) neredeyse boş tabloları taradığı için düşük — 1469 müşteri + aylarca sipariş + `order_items` altında bu rakamlar **büyür**. Blok 3/7'nin index bulguları (`reports/order_items index yok` — DB-TX-04+R7-AGG-PERF-01+R6-TBL-01) tam bu hacimde ısırır. **Gerçek kırılma noktası için üretim-benzeri seed gerekir** (bu oturumun kapsamı dışı; Blok 13 fix fazında öneri).

## 1. Senaryolar & sonuçlar (0 hata — tüm istekler yanıtlandı)

| Senaryo | conc | istek | p50 | p95 | p99 | max | rps | hata |
|---|---|---|---|---|---|---|---|---|
| **read** (hot-path: tables/products/orders/categories) | 20 | 600 | 51ms | 84ms | 193ms | 305ms | 360 | 0 |
| **reports** (snapshot + hourly-revenue agregasyon) | 12 | 240 | 45ms | 59ms | 64ms | 73ms | 263 | 0 |
| **pool** (snapshot @ yüksek concurrency) | 80 | 800 | **335ms** | 411ms | 487ms | 561ms | 235 | 0 |
| **login** (rate-limit ölçümü) | 8 | 40 | 7.5ms | 228ms | 231ms | 231ms | 163 | 0 |

## 2. Yorum

**read (hot-path) — SAĞLIKLI.** p95=84ms @ 360 rps, 20 eşzamanlı. Restoran gerçeği: 25 masa + paket, tepe yük ~1-2 rps. Kasiyer/garson akışı için kapasite fazlasıyla yeterli; p99=193ms tek sıçrama (muhtemelen ilk-bağlantı/JIT).

**reports — DAR ama YANILTICI.** p99=64ms çok iyi görünüyor AMA §0 uyarısı: boş tablolar. Not: senaryo `snapshot`+`hourly-revenue` (store-date "bugün" default, parametresiz). Gerçek hacimde Blok 7 tz/index bulguları devreye girer.

**pool (conc=80) — ZARIF KUYRUK, TÜKENME YOK.** Tipik pg pool (~10) çok üstünde 80 eşzamanlı: p50 **7× tırmandı** (45→335ms) çünkü istekler pool'da kuyruğa giriyor — AMA **sıfır hata, sıfır timeout, sıfır 5xx.** Pool tükenme-hatası yerine **backpressure/kuyruk** uyguluyor (sağlıklı degrade). Bu concurrency'de sert kırılma noktası bulunamadı → daha yükseğe itilebilir (gelecek iş). Restoran gerçeğinde 80 eşzamanlı imkânsız (birkaç cihaz); bu senaryo yalnız pool-emniyet-marjını gösterir → **geniş marj var.**

**login — RATE-LIMIT AKTİF (bimodal latency).** p50=7.5ms (hızlı 429-red) vs p95/p99=228ms (gerçek bcrypt login) = `loginLimiter` (5/15dk) çalışıyor: ilk ~5 istek bcrypt ile ~228ms, gerisi 429 ile ~7ms. Not: harness 429'u "yanıt" sayar (hata değil) — bu yüzden err=0; bimodal dağılım limitin devrede olduğunun kanıtı. bcrypt ~228ms = maliyetli-ama-doğru (brute-force direnci; ADR-002 cost ayarı).

## 3. Kaynak/pool davranışı özeti
- **Pool tükenme modu:** kuyruk (backpressure), hata değil — 80 conc'de 0 timeout. Emniyet marjı geniş.
- **Rate-limit:** loginLimiter doğrulandı (bimodal). `/refresh` + agent endpoint'leri Blok 4/11'de ayrı denetlendi.
- **bcrypt latency:** ~228ms/login — tekil kullanıcıda sorun değil; toplu-login yükünde (yok — tek tenant) düşünülürdü.

## 4. Sınırlar & gelecek iş (dürüstlük)
- **Boş-DB:** en büyük sınır. Üretim-benzeri seed (1469 müşteri + N-aylık sipariş) ile reports/customers-liste/order-items senaryoları tekrarlanmalı — Blok 3/7 index bulgularının gerçek etkisini ölçmek için.
- **Koşulmayan senaryolar:** master-prompt'un `order-create` (write hot-path), `void→reopen concurrency` (tek adisyona N eşzamanlı — DB-TX-05 BLOCKER'ın tam yüzeyi!), `print-enqueue flood`, `realtime fanout` senaryoları bu oturumda write-state + idempotency kurulumu gerektirdiğinden **koşulmadı**. Özellikle **void→reopen concurrency**, Blok 3 DB-TX-05 (idempotency-race recovery kırık) BLOCKER'ını canlı tetikleyebilir → fix sonrası regresyon-testi olarak eklenmeli.
- **Tek makine:** client + API + DB aynı PC (dev makinesi) — ağ latency'si yok; prod (Hetzner + Nginx + client-üzerinden-internet) farklı profil.

**Sonuç:** Concurrency/pool/rate-limit duruşu **sağlam ve geniş-marjlı** (tek-tenant restoran için fazlasıyla yeter). Nicel query-performansı **ölçülemedi** (boş DB) — bu, denetimin bilinen açık ucu, Blok 0 coverage-ölçülemedi bulgusuyla aynı sınıfta (nicel taban eksik).
