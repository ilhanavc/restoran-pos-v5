/**
 * Bir masanın AÇIK adisyonunun kimliğini masa tahtası projeksiyonundan çözer.
 *
 * ## Neden liste ucu değil, masa projeksiyonu
 *
 * `GET /orders` **her zaman** bir `store_date` süzgeci uygular; istemci tarih
 * göndermezse sunucu **bugünü** (tenant tz) koyar
 * (`apps/api/src/routes/orders.ts` legacy liste handler'ı). Mobil, masanın açık
 * adisyonunu bulmak için o ucu `?tableId=` ile çağırıyordu → gece yarısını
 * aşan (dün açılmış, hâlâ açık) bir adisyon listede **hiç dönmüyordu**:
 *  - masa tahtası masayı DOLU gösteriyordu (`GET /tables` projeksiyonu
 *    tarihten bağımsız; yalnız terminal olmayan statüyü süzer),
 *  - masaya dokunan garson ise BOŞ sepet görüyordu,
 *  - üstüne kalem kaydetmeye kalkınca istemci yeni adisyon açmaya çalışıyor ve
 *    "masa başına tek aktif adisyon" kısmi-unique indeksine (Migration 041)
 *    çarpıyordu → masa mobilden tamamen kullanılamaz hâle geliyordu (#790).
 *
 * `GET /tables` zaten `active_order_id` döndürüyor ve web uygulaması masanın
 * adisyonunu **bu alandan** çözüyor (`apps/web/src/features/orders/OrderScreenPage.tsx`
 * → `table.active_order_id`). Yani doğru cevap tel üzerinde hâlihazırda vardı;
 * mobil yanlış soruyu soruyordu. Bu fonksiyon o çözümü saf tutar: taşıma katmanı
 * (`api/client.ts`) İKİNCİ bir koşul taşımaz — tek koruma hattı, tek test
 * noktası (bkz. `apps/mobile/vitest.config.ts`).
 */

/**
 * Çözüm için gereken minimum masa şekli. Yapısal tip: mobil `ApiTable` bunu
 * karşılar, ama bu modül RN/expo kaynaklarını import ETMEZ → saf node testinde
 * koşabilir.
 */
export interface TableActiveOrderProjection {
  id: string;
  /** Terminal olmayan (açık) adisyonun kimliği; masa boşsa `null`. */
  active_order_id: string | null;
}

/**
 * Masanın açık adisyon kimliği, ya da `null`.
 *
 * `null` iki ayrı gerçeği birden ifade eder ve ikisi de aynı davranışı ister
 * (sipariş ekranı boş açılır): masa boş, ya da masa projeksiyonda hiç yok
 * (silinmiş/başka tenant → RLS 0 satır).
 */
export function resolveActiveOrderIdForTable(
  tables: readonly TableActiveOrderProjection[],
  tableId: string,
): string | null {
  const table = tables.find((t) => t.id === tableId);
  return table?.active_order_id ?? null;
}
