# v3 Refund vs v5 Ödeme-Void + Reopen — Ayrım Notu (ADR-033)

> **Kaynak:** `D:\dev\restoran-pos-v3\` READ-ONLY. v3'ten kod taşınmaz; bu doküman
> ADR-033'ün v3-parite gerekçesini (CLAUDE.md core directive 6) **kendi cümlelerimle**
> özetler. Copy-paste yok.

## Etiket sözlüğü
- **Kodda tespit:** v3 dosyasında görülen davranış
- **Değerlendirme:** v5 mimari kararı

---

## 1. v3'te ne vardı? (REFUND modeli)

**Kodda tespit:** v3'te ödeme geri-alma `server/services/refundService.js` + ayrı bir
`refunds` tablosu ile yapılıyordu; `refunds.integration.test.js` kapsıyordu. Model
**telafi (offsetting) kaydı** üzerine kuruluydu:

- `createFullRefundForOrder` yalnız `order.status === 'closed'` olan siparişe uygulanırdı.
- Sipariş **kapalı KALIRDI** — iade, siparişi yeniden açmaz; tersine, offsetting bir
  `refunds` satırı yazardı (negatif/telafi muhasebe kaydı).
- `assertPeriodOpenForMutation` ile **dönem (period) açıkken** sınırlıydı — bu, v3'ün
  "aynı-gün" analogudur (gün-sonu/period kapandıktan sonra iade edilemez).
- Sebep **opsiyoneldi** (varsayılan "Tam sipariş iadesi" gibi bir metin).
- Kısmi tutar iadesi destekleniyordu.

**Kodda tespit:** v3'te **reopen (masayı/adisyonu yeniden açma) YOKTU.** İade siparişi
açmaz, yalnızca telafi kaydı ekler; masa boşta kalırdı.

---

## 2. v5'te ne yapıyoruz? (VOID + REOPEN modeli, ADR-033)

**Değerlendirme:** Düzeltme *yeteneği* v3 paritesidir (v3'te iade vardı → v5 MVP borcu
meşru). Ancak *mekanizma* bilinçli olarak farklıdır ve aynı-gün senaryosu için daha
temizdir:

| Boyut | v3 refund | v5 void+reopen (ADR-033) |
|---|---|---|
| Kayıt | Ayrı `refunds` offsetting satırı | Aynı `payments` satırına soft-void (3 kolon) |
| Sipariş durumu | `closed` KALIR | paid ise **auto-reopen → open** (masa geri dolar) |
| Zaman sınırı | period açık | **aynı gün** (`order.store_date === bugün`) |
| Sebep | opsiyonel serbest metin | **zorunlu ENUM** (PII sızıntısı önlemi) |
| Kısmi tutar | destekli | **YOK** (satır bütün void; "ödeme hiç olmadı") |
| Masa düzeltme | çözmez (masa boşta) | **çözer** — yanlış masa kapatıldıysa geri açılır |

**Neden void+reopen (aynı-gün için):** v3'ün offsetting modeli "yanlış masa kapatıldı,
tekrar aç" ihtiyacını çözmez — masa boşta kalır, adisyon düzeltilemez. Aynı-gün için
"ödeme hiç olmadı" mental modeli (soft-void + reopen) hem daha az kayıt üretir hem de
masayı doğru şekilde geri açar.

**Neden v3 modeli tamamen atılmadı:** v3'ün offsetting-refund + period yaklaşımı
**cross-day** (ertesi-gün) senaryosuna daha uygundur. ADR-033 bunu **v5.1'e** kilitler
(`payment.refunded` audit event'i bilinçli REZERVE edilir, ADR-024 K4; audit
whitelist'i boş bırakılır). v5.0'da cross-day void istenirse `PAYMENT_VOID_CROSS_DAY`
(409) döner.

---

## 3. Kapsam kilidi (v5.1+, ADR-033 K9)

Aşağıdakiler v5.0 MVP'de YOK, v3'te de doğrudan yoktu veya farklı modeldeydi:
- Cross-day refund (v3 offsetting `refunds` + rezerve `payment.refunded`)
- Kısmi-tutar void
- Kart "adjust" / gerçek POS-terminal iadesi (donanım entegrasyonu YOK)
- Takeaway ödeme-void + stage geri-alma
- Ödeme-bağımsız standalone reopen
- Serbest-metin sebep notu (PII işlemeli)
