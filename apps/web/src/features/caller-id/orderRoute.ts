/**
 * Çağrıdan (Caller ID) "Sipariş Aç" → paket sipariş rotası — ADR-016 §11.
 *
 * Hem gelen-arama popup'ı (IncomingCallProvider) hem son-çağrılar modalı
 * (RecentCallsModal) bu tek kaynağı kullanır:
 *   - Bilinen müşteri  → `/orders/new?type=takeaway&customerId=X`
 *     (OrderScreenPage müşteriyi ön-seçer, picker açılmaz)
 *   - Bilinmeyen arayan → `/orders/new?type=takeaway&phone=X`
 *     (paket ekranı + müşteri seçici telefonla ön-dolu, hızlı oluştur/bul)
 *
 * Eskiden `/customers/:id` (müşteri DÜZENLEME) ya da `/customers?new=1` idi
 * (PR-8c-2 placeholder) — bu yanlıştı; "Sipariş Aç" sipariş başlatmalı.
 */
export function callToTakeawayRoute(
  customerId: string | null,
  phone: string | null,
): string {
  const params = new URLSearchParams({ type: 'takeaway' });
  if (customerId !== null) {
    params.set('customerId', customerId);
  } else if (phone !== null && phone.length > 0) {
    params.set('phone', phone);
  }
  return `/orders/new?${params.toString()}`;
}
