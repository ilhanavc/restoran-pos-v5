import type { UserPublic } from '@restoran-pos/shared-types';

import { useAuthStore } from './auth';
import { canCreateTakeaway } from './roleAccess';

/**
 * Rol-tabanlı UI görünürlüğü — TEK KAYNAK (ADR-026 K6 + Amendment 5 K1).
 *
 * Frontend gating bir GÜVENLİK kontrolü değildir (sunucu RBAC'ı ikinci ve
 * otoriter katmandır); burada verilen karar bir UX kararıdır: yetkisiz yüzey
 * hiç render edilmez ve isteği de atılmaz. Daha önce bu mantık
 * `TablesScreen` içine gömülüydü; Satış sekmesi doğunca iki yere kopyalanmasın
 * diye buraya taşındı (Amd5 K1: "yetki kaynağı tek yer").
 */
export type SessionRole = UserPublic['role'];

/**
 * ADR-039 K10 kararı `roleAccess.ts`'te (bağımlılıksız, birim-testli) durur;
 * burada yalnız reaktif sarmalayıcısı vardır. Çağıranlar tek yerden
 * (`store/permissions`) import etmeye devam edebilsin diye yeniden dışa
 * aktarılır — "yetki kaynağı tek yer" ilkesi korunur.
 */
export { canCreateTakeaway } from './roleAccess';

/** Ciro/satış rakamlarını görebilen roller (ADR-013 Amd3 K3 `canComp` kümesi). */
const REVENUE_ROLES: ReadonlySet<SessionRole> = new Set<SessionRole>([
  'admin',
  'cashier',
]);

/**
 * Rol ciro görebilir mi? Profil henüz yüklenmemişken (`null`/`undefined`)
 * GÜVENLİ yön: `false` — bilinmeyen rolde para rakamı gösterilmez.
 */
export function canSeeRevenue(role: SessionRole | null | undefined): boolean {
  return role !== null && role !== undefined && REVENUE_ROLES.has(role);
}

/**
 * {@link canSeeRevenue}'in REAKTİF hali (zustand selector).
 *
 * **Kritik:** rol açılışta `null` olup SONRA dolabilir (profil SecureStore'dan
 * hidrate edilir ya da `GET /auth/me` ile tazelenir — S105 #489). Bu hook
 * store'a abone olduğu için rol geldiğinde çağıran bileşen yeniden render
 * edilir; anlık bir snapshot alınıp donmaz. Sekme listesi bunun üzerine
 * kurulur → "rol null iken 3 sekme kurulup öyle kalma" hatası oluşmaz.
 */
export function useCanSeeRevenue(): boolean {
  return useAuthStore((state) => canSeeRevenue(state.user?.role));
}

/**
 * Kalem taşıma yetkisi olan roller (ADR-035 S9) — kitchen HARİÇ.
 * "Koruma rolde değil ödeme kuralında": garson da taşıyabilir, ödenmiş kalemi
 * kimse taşıyamaz (sunucu 409 ORDER_ITEM_ALREADY_PAID).
 */
const MOVE_ITEM_ROLES: ReadonlySet<SessionRole> = new Set<SessionRole>([
  'admin',
  'cashier',
  'waiter',
]);

/**
 * Rol ürünü başka masaya taşıyabilir mi? Profil yüklenmemişken (`null`)
 * GÜVENLİ yön: `false` — bilinmeyen rolde yıkıcı yüzey render edilmez.
 */
export function canMoveItem(role: SessionRole | null | undefined): boolean {
  return role !== null && role !== undefined && MOVE_ITEM_ROLES.has(role);
}

/**
 * {@link canMoveItem}'in REAKTİF hali (zustand selector) — rol açılışta `null`
 * olup SONRA dolabilir (SecureStore hidrasyonu / `GET /auth/me`, S105 #489);
 * store'a abone olduğu için buton rol geldiğinde belirir, donmuş kalmaz.
 */
export function useCanMoveItem(): boolean {
  return useAuthStore((state) => canMoveItem(state.user?.role));
}

/**
 * {@link canCreateTakeaway}'in REAKTİF hali (zustand selector) — rol açılışta
 * `null` olup SONRA dolabilir; FAB rol geldiğinde belirir, donmuş kalmaz.
 */
export function useCanCreateTakeaway(): boolean {
  return useAuthStore((state) => canCreateTakeaway(state.user?.role));
}
