import { KDS_ORDERS_KEY } from '../kitchen/keys';

/**
 * Paket sipariş kaydedildikten sonraki cache tazelemesi (ADR-039 K5.5).
 *
 * **Neden ayrı bir fonksiyon:** K5.5, K6'daki asimetrinin ("garson paket
 * siparişi açar ama yönetemez") en önemli telafisidir — garson kaydettiği
 * siparişi döndüğü Mutfak listesinde ANINDA görmeli, yoksa "kayboldu mu?"
 * sorusu doğar. Bu davranış bir ekran detayı değil, ADR'nin açık bir kararı
 * olduğu için ekrandan ayrılıp birim testle korunur (DoD 23b).
 *
 * Bağımlılık, TanStack `QueryClient`'ın yalnız ihtiyaç duyulan yüzeyine
 * daraltıldı — test sahte bir istemciyle koşabilsin ve gerçek bir React
 * ortamı gerekmesin.
 */
export interface InvalidatingClient {
  invalidateQueries(filters: { queryKey: readonly unknown[] }): unknown;
}

export function invalidateAfterTakeawaySave(client: InvalidatingClient): void {
  // Mutfak kuyruğu — yeni sipariş "en yeni üstte" ilk sırada belirir.
  client.invalidateQueries({ queryKey: KDS_ORDERS_KEY });
  // Açık sipariş sorguları (web paneli/masalar ile aynı aile).
  client.invalidateQueries({ queryKey: ['orders'] });
}
