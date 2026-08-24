import type { UserPublic } from '@restoran-pos/shared-types';

/**
 * Rol → yüzey görünürlüğü kararları — **BAĞIMLILIKSIZ** saf modül (ADR-039).
 *
 * Neden `permissions.ts`'in içinde değil: `permissions.ts` zustand store'unu
 * (dolayısıyla `expo-secure-store`u) import eder ve React Native dışında
 * yüklenemez. Rol görünürlüğü ADR-039 K10'da **tek koruma hattı** olduğu için
 * (Mutfak sekmesinin rol gate'i YOKTUR) birim testle doğrulanabilir olmak
 * zorundadır. Karar burada, reaktif sarmalayıcısı `permissions.ts`'te durur —
 * "yetki kaynağı tek yer" ilkesi korunur, yalnız katman ikiye ayrılır.
 */
export type SessionRole = UserPublic['role'];

/**
 * Paket sipariş OLUŞTURABİLEN roller (ADR-039 K10.2) — `kitchen` HARİÇ.
 *
 * Sunucu hattı bağımsız korur: `POST /orders` takeaway dalı
 * `authorize(['admin','cashier','waiter'])` → mutfak terminali 403 alır
 * (K10.3). Buradaki gate bir GÜVENLİK kontrolü değil, UX kararıdır: yetkisiz
 * yüzey hiç render edilmez.
 */
const TAKEAWAY_CREATE_ROLES: ReadonlySet<SessionRole> = new Set<SessionRole>([
  'admin',
  'cashier',
  'waiter',
]);

/**
 * Rol Mutfak ekranındaki "Paket Sipariş" FAB'ını görür mü?
 * (ADR-039 K10.2 / K10.4)
 *
 * **Bu tek satır FAB'ın TEK koruma hattıdır.** Mutfak sekmesi bilinçli olarak
 * KOŞULSUZ kayıtlıdır (`MainTabs.tsx` — Amd5 K7: aşçı kuyruğu görmeye devam
 * etsin), yani `kitchen` rolü de bu ekranı açar; yetkiyi ayıran yer burasıdır.
 *
 * Rol bilinmezken (`null`/`undefined` — profil `GET /auth/me` ile
 * tazelenemedi, ağ yok) GÜVENLİ yön `false`'tur: yetkisiz yüzey render
 * EDİLMEZ. Mevcut `canSeeRevenue`/`canMoveItem` felsefesiyle birebir; yeni bir
 * varsayılan icat edilmez.
 */
export function canCreateTakeaway(
  role: SessionRole | null | undefined,
): boolean {
  return role !== null && role !== undefined && TAKEAWAY_CREATE_ROLES.has(role);
}
