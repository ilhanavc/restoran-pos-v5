---
name: turkish-restaurant-domain
description: Use for Turkish restaurant-specific business rules, e-Fatura/e-Arşiv integration, yazarkasa (fiscal printer) integration, Yemeksepeti/Getir/Trendyol Yemek platform integrations, and Turkish tax regulations.
---

# Türkiye Restoran Domain Know-How

> **v5 MVP kapsam notu**: Bu skill'in **KDV, kuver/garsoniye, ikram, iskonto, vardiya** bölümleri MVP'de aktif kullanımda. **e-Fatura/e-Arşiv, yazarkasa (ÖKC), Yemeksepeti/Getir/Trendyol** bölümleri **v5.1+ için referans** — MVP'de uygulanmaz. Project charter'da açıkça non-goal. Kapsam büyümesi teklifi geldiğinde önce ADR, sonra implementasyon.

Türkiye pazarında restoran POS'u çalıştırmanın temel unsurları.


## KDV (Katma Değer Vergisi)

### Oranlar (2026)
- Ana yemek / gıda: %10
- İçecek (alkollü): %20
- İçecek (alkolsüz): %10
- Hizmet bedeli: %20 (servis ücreti)

### Hesaplama
```typescript
// Fiyatlar KDV dahil tutuluyor (restoran pratiği)
function extractVAT(grossKurus: number, vatRate: number): { net: number; vat: number } {
  const divisor = 1 + vatRate / 100;
  const netKurus = Math.round(grossKurus / divisor);
  const vatKurus = grossKurus - netKurus;
  return { net: netKurus, vat: vatKurus };
}
```

Yuvarlama ödemede önemli: round-half-to-even (banker's rounding) tercih edilir.

## e-Fatura ve e-Arşiv

### Ne zaman hangisi?

- **e-Fatura**: Karşı taraf da e-Fatura mükellefi ise (B2B). GİB üzerinden karşı taraf sistemine iletilir.
- **e-Arşiv**: Karşı taraf son tüketici (B2C) veya e-Fatura mükellefi değil. GİB'e raporlanır ama karşı tarafa PDF/e-posta.

### Mükelleflik sorgulama

GİB web servisi üzerinden VKN/TCKN kontrolü:
- `https://efatura.gib.gov.tr/efaturaregistration/...`
- Web servis çağrısı ile gerçek zamanlı kontrol
- Cache: 24 saat yeterli

### Entegrasyon partner'leri

Doğrudan GİB entegrasyonu değil, aracı firmalar (özel entegrator):
- Foriba (Logo)
- Uyumsoft
- Izibiz
- Parasut
- Logo Mint

Her birinin farklı REST API'si var. Bir abstract layer yazıyoruz:

```typescript
interface EInvoiceProvider {
  createInvoice(data: InvoiceData): Promise<InvoiceResult>;
  checkStatus(invoiceId: string): Promise<InvoiceStatus>;
  sendToRecipient(invoiceId: string): Promise<void>;
  cancelInvoice(invoiceId: string, reason: string): Promise<void>;
}

class FobibaProvider implements EInvoiceProvider { /* ... */ }
class UyumsoftProvider implements EInvoiceProvider { /* ... */ }
```

### e-Arşiv rapor

Her ay 7'sine kadar GİB'e aylık e-Arşiv raporu gönderilir. Bu rapor:
- Ay içindeki tüm e-Arşiv faturaların özeti
- Tax ID'leri, tutarlar, tarihler
- Aracı firma üzerinden otomatik iletilir

## Yazarkasa entegrasyonu

### Neden gerekli?

Yasa gereği mali değeri olan belge kesmek için **mali mühürlü yazarkasa** zorunlu. Restoran POS adisyon/fatura bastığında ayrıca yazarkasa fişi de gerekli.

### Desteklenen markalar

- **Ingenico**: ISO 20022 / özel protokol
- **Pavo**: API bazlı
- **Beko / Hugin**: Seri port protokolü
- **Olivetti**: API

### Entegrasyon protokolü

Çoğu yazarkasa:
- USB serial üzerinden bağlı
- Vendor'un Windows SDK'sı var (çoğu C# / C++)
- POS'tan sipariş detayları gönderilir → yazarkasa fiş keser → POS'a sonuç döner

### Fiş içeriği

Yazarkasaya gönderilen:
- Ürün adı (max 20-30 karakter)
- Adet
- Birim fiyat (kuruş)
- KDV oranı
- Toplam
- Ödeme yöntemi

Yazarkasa otomatik:
- KDV hesaplar ve ayırır
- Mali numara atar
- GİB'e online raporlar (Yeni Nesil ÖKC'lerde)

### Kod örneği (abstract)

```typescript
interface FiscalPrinter {
  openReceipt(): Promise<void>;
  addItem(name: string, priceKurus: number, quantity: number, vatRate: number): Promise<void>;
  addPayment(type: 'cash' | 'card', amountKurus: number): Promise<void>;
  closeReceipt(): Promise<FiscalReceipt>;
}

interface FiscalReceipt {
  fiscalNumber: string;
  zReportNumber: number;
  timestamp: Date;
  totalKurus: number;
  vatBreakdown: Record<number, number>; // { 10: 500, 20: 200 }
}
```

## Yemek platform entegrasyonları

### Yemeksepeti (Delivery Hero)

- API: [Yemeksepeti Integration Portal](https://integration.yemeksepeti.com/) (partner başvuru gerekli)
- Kanal: REST webhook
- Model:
  - Menü sync (POS → Yemeksepeti)
  - Sipariş alma (Yemeksepeti → POS webhook)
  - Sipariş durum güncelleme (hazırlanıyor, yolda, teslim edildi)
  - Stok durumu

### Getir Yemek

- API: Getir Merchant Platform
- Benzer akış: menu sync + order webhook + status update

### Trendyol Yemek

- Daha yeni, partnership API'si gelişiyor
- Webhook bazlı

### Migros Yemek (Getir Food kapsamında)

- Getir Yemek API'si ile birleşik

### Platform abstract layer

```typescript
interface DeliveryPlatform {
  syncMenu(menu: Menu): Promise<void>;
  receiveOrder(webhookPayload: unknown): Promise<PlatformOrder>;
  updateStatus(orderId: string, status: OrderStatus): Promise<void>;
  setAvailability(productId: string, available: boolean): Promise<void>;
}

class YemekSepetiAdapter implements DeliveryPlatform { /* ... */ }
class GetirYemekAdapter implements DeliveryPlatform { /* ... */ }
class TrendyolYemekAdapter implements DeliveryPlatform { /* ... */ }
```

Orchestration:
- Yemek platformundan gelen sipariş → POS'a aktarılır
- Mutfak adisyonu basılır (platform logosu ile)
- Hazır olunca → platform API ile "hazırlandı" durumu
- Kurye atanır, teslim edildi → "teslim edildi"

## Personel hiyerarşisi ve yetkiler

```
Patron (Tenant owner)
  │
  ├── Müdür (Branch manager)
  │   ├── Müdür yardımcısı
  │   ├── Kasiyer
  │   │   └── (ödeme alma, gün sonu)
  │   ├── Garson
  │   │   └── (sipariş alma, masa yönetimi)
  │   ├── Komi
  │   │   └── (yardımcı, sipariş taşıma)
  │   └── Mutfak
  │       ├── Şef
  │       └── Aşçı
  └── Bar
      └── Barmen
```

## Vergi ve yasal zorunluluklar

### Belge çeşitleri

| Belge | Zorunlu | Ne zaman? |
|---|---|---|
| Yazarkasa fişi | ✅ Her ödeme | Her satış |
| e-Arşiv fatura | ✅ İstenirse | Son tüketici isteği |
| e-Fatura | ✅ B2B | Mükellef karşı taraf |
| Adisyon | 📋 İç kullanım | Müşteri ödemeden önce görür |

### Saklama süreleri

- Fiş: 5 yıl
- Fatura: 10 yıl
- Z raporu: 5 yıl
- Müşteri verisi: KVKK kapsamında (opt-in'e göre 6 ay - 5 yıl)

## Servis bedeli

Bazı restoranlar otomatik %5-10 servis bedeli ekler:
- UI'da açıkça gösterilmeli ("Hesaba %10 servis eklenmiştir")
- Müşteri istemiyorsa kaldırılabilmeli (çoğu yer zorunlu tutmuyor, ama yasa "ihtiyaridir" der)
- Personel bahşişi dağıtımı: havuz veya direkt garson (restaurant policy)

## Ödeme yöntemleri

Türkiye pazarında yaygın:
- Nakit
- Kredi/Banka kartı
- Yemek kartları: Multinet, Sodexo, Ticket Restaurant, Setcard, Edenred
- QR ödeme: BKM Express, FAST
- Mobil ödeme: Paycell, iyzico Mobil

Her yöntem için:
- POS cihazı/entegrasyon farklı
- Komisyon farklı
- Raporlama ayrı

## Vergisel raporlar

- **X raporu**: Gün içinde istenen anlık durum (zero-out yapmaz)
- **Z raporu**: Gün sonu kesin rapor, GİB'e otomatik iletilir (Yeni Nesil ÖKC'de)
- **Aylık KDV beyanı**: 20'sine kadar
- **Yıllık gelir vergisi**: Mart sonu
- **Ba/Bs formları**: Aylık, muhasebecisine veri

Bizim POS bunların hammadde verisini sağlar, muhasebe yazılımına export:
- LUCA
- Logo Tiger / Mikro
- Parasut
- Bizimhesap
