/**
 * Mutfak (KDS) sorgu anahtarı — **bağımlılıksız** modül.
 *
 * `queries.ts` içinde de durabilirdi; oradan import etmek `api/client` →
 * `api/http` → `store/auth` → `expo-secure-store` zincirini çeker ve React
 * Native dışında (birim testte) yüklenemez. ADR-039 K5.5'in "kaydettikten
 * sonra Mutfak listesi TAZELENİR" garantisi test edilebilir olmalı, bu yüzden
 * anahtar buraya ayrıldı. Web KDS ile AYNI kontrat (tek endpoint, tek anahtar).
 */
export const KDS_ORDERS_KEY = ['kds', 'orders'] as const;

/**
 * Açık paket sipariş kuyruğu (ADR-039 Amendment 2 K3). Aynı gerekçeyle burada:
 * mutasyon sonrası invalidate etmek isteyen saf modüller RN zincirini çekmesin.
 *
 * KDS anahtarından AYRI: iki sekme iki ayrı uç okuyor (`/kds/orders` vs
 * `/orders?type=takeaway&status=open`) ve görünmeyen sekme poll etmemeli.
 */
export const TAKEAWAY_QUEUE_KEY = ['orders', 'takeaway', 'open'] as const;
