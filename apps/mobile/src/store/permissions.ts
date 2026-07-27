import type { UserPublic } from '@restoran-pos/shared-types';

import { useAuthStore } from './auth';

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
