import type { ApiOrderItem } from '../../api/orders';

/**
 * Waiter edit gate for a saved order item (ADR-026 K6 + ADR-008 §7b).
 *
 * A waiter may amend (stepper / void) a SAVED item only when it is BOTH their
 * own AND still `status === 'new'` (not yet sent to the kitchen). Items sent to
 * the kitchen, or another waiter's items, are read-only — the edit affordance
 * is not rendered at all (K6: unauthorised actions are never shown). Pending,
 * not-yet-saved cart lines are always editable (they are local, own, and new by
 * construction) and do not pass through this gate.
 *
 * The real stepper/void mutations against these saved items land in PR-5d (they
 * need `PATCH /orders/:orderId/items/:itemId`); until then saved items render
 * read-only and only this predicate decides whether the affordance shows.
 */
export function canWaiterEditOrderItem(
  item: Pick<ApiOrderItem, 'status' | 'created_by_user_id'>,
  _currentUserId: string | null,
): boolean {
  // S104 — SAHİPLİK KOŞULU KALDIRILDI. İki gerekçe:
  //
  // (1) SUNUCU BÖYLE DAVRANMIYOR. Backend kuralı (orders.ts §PATCH item):
  //     `status='new'` → TÜM staff void edebilir; `status!=='new'` →
  //     admin/cashier. Sahiplik şartı YOK. İstemci sunucudan katıydı.
  //
  // (2) ADR-027 Amendment 2 K1 sahiplik-ABAC'ını AÇIKÇA REDDETTİ (garson zaten
  //     başkasının masasında ödeme alıyor; "only own orders" yorumları bayat).
  //
  // 🐛 Asıl canlı belirti: `auth.ts` uygulama yeniden başlarken UserPublic'i
  // GERİ YÜKLEMİYOR (yalnız token) → `currentUserId` null → eski koşul her
  // kalem için false dönüyordu ve garson TÜM adisyonu "Kilitli" görüyordu,
  // hiçbir kalemi iptal edemiyordu. Her OTA güncellemesi de yeniden başlatma
  // olduğu için etki yaygındı.
  //
  // S104 ikinci tur (ürün sahibi): `status === 'new'` koşulu da KALKTI —
  // "mobildeki tüm ürünlerden kilitli özelliğini kaldırmamız lazım".
  //
  // Tek başına istemci değişikliği YETMEZDİ: sunucu mutfağa gitmiş kalemi
  // garsona 403'lüyordu → afford görünür, dokunuş hata verirdi. Bu yüzden
  // sunucudaki İKİ kapı (sahiplik + gönderilmiş-durum) AYNI PR'da kaldırıldı,
  // yerine ADR-027 Amd2 K3 PARA kapısı kondu (aktif ödemesi olan adisyonda
  // kalem void'i 409 ORDER_HAS_PAYMENTS — tüm roller, admin dahil).
  //
  // Gerekçe: garson ADR-027 Amd2 ile TÜM adisyonu iptal edebiliyor; tek kalemi
  // edememesi tutarsızdı — "koruma rolde değil PARA DURUMUNDA".
  return true;
}
