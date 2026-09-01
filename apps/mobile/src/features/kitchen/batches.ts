import type { KdsItem, KdsOrder } from '../../api/schemas';

/**
 * Mutfak kuyruğunun satır birimi: bir GÖNDERİM (parti) — ADR-026 Amendment 6.
 *
 * Kart artık "bir açık sipariş" değil, "bir masaya/pakete ait tek bir mutfak
 * gönderimi"dir (K1). Böylece ekran, kağıt mutfak fişiyle birebir eşleşir
 * (ADR-032 Amd3 / S103: bir gönderim = bir fiş).
 *
 * `KitchenScreen` React Native bileşenlerini import ettiği için render
 * testi yazılamaz (bkz. `vitest.config.ts` JSDoc'u); bu yüzden gruplama
 * kararı bileşenden AYRI, saf fonksiyona çekilmiştir — bileşen bu fonksiyonun
 * dışında ikinci bir gruplama/sıralama koşulu TAŞIMAZ.
 */
export interface KitchenBatch {
  /** `${orderId}:${batchAt}` — sipariş id'si tek başına artık benzersiz değil (K5). */
  key: string;
  orderId: string;
  /** Adisyon numarası; ilave kartında da AYNI kalır (K5 — "hangi adisyon" bağı). */
  orderNo: number;
  orderType: KdsOrder['orderType'];
  tableCodeSnapshot: string | null;
  areaNameSnapshot: string | null;
  customerName: string | null;
  /** Gönderim anı — sunucudan gelen ISO metni, yeniden yorumlanmadan (K2). */
  batchAt: string;
  /** `batchAt > order.createdAt` → İLAVE rozeti (K6). */
  isAddition: boolean;
  items: KdsItem[];
}

/**
 * Açık siparişlerin mutfak kalemlerini GÖNDERİM bazlı kartlara böler ve
 * en yeni gönderim üstte olacak şekilde sıralar (K1 + K4).
 *
 * **Gruplama anahtarı `(orderId, item.createdAt)` ve eşitlik TAM'dır (K2).**
 * Tek gönderim tek transaction'dır → PostgreSQL `now()` transaction başlangıç
 * zamanıdır → o turdaki bütün kalemler mikrosaniyesine kadar aynı damgayı
 * taşır. Zaman toleransı / "yakın damgaları birleştir" heuristiği YASAKTIR:
 * iki meşru gönderimi sessizce birleştirir ve hatası görünmez olur.
 *
 * **Her kalem TAM OLARAK bir kartta görünür (K3, bağlayıcı).** İlk siparişin
 * kalemleri ilave kartında tekrar edilmez — mutfakta çift üretim, bu ekranın
 * yaratabileceği en pahalı hatadır.
 *
 * Sıralama: ISO-8601 UTC string'lerde sözlük sırası = kronolojik sıra, bu
 * yüzden `localeCompare` yeterli (Date parse gerekmez). Eşit damgalı kartlarda
 * sıralama kararlıdır (ES2019 stable sort) → sunucunun FIFO düzeni korunur.
 *
 * Girdi mutasyona uğramaz; `items` dizileri yeni referanslardır.
 */
export function groupIntoBatches(orders: readonly KdsOrder[]): KitchenBatch[] {
  const batches: KitchenBatch[] = [];

  for (const order of orders) {
    // Damga → kart. `Map` ekleme sırasını korur; kalemler sunucudan
    // `created_at ASC` geldiği için kart içi sıra da kararlıdır.
    const byBatchAt = new Map<string, KdsItem[]>();
    for (const line of order.items) {
      const existing = byBatchAt.get(line.createdAt);
      if (existing === undefined) {
        byBatchAt.set(line.createdAt, [line]);
      } else {
        existing.push(line);
      }
    }

    for (const [batchAt, items] of byBatchAt) {
      batches.push({
        key: `${order.id}:${batchAt}`,
        orderId: order.id,
        orderNo: order.orderNo,
        orderType: order.orderType,
        tableCodeSnapshot: order.tableCodeSnapshot,
        areaNameSnapshot: order.areaNameSnapshot,
        customerName: order.customerName,
        batchAt,
        // Rozet kuralı siparişin KENDİ zamanıyla belirlenir, listedeki sırayla
        // DEĞİL (K6): ilk gönderim servis edilip kuyruktan düşerse "görünen en
        // eski kart orijinaldir" varsayımı yanlış etiketlerdi.
        isAddition: batchAt > order.createdAt,
        items,
      });
    }
  }

  return batches.sort((a, b) => b.batchAt.localeCompare(a.batchAt));
}
