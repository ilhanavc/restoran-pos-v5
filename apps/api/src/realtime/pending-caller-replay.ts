import type { Kysely } from 'kysely';
import {
  createCallLogsRepository,
  createCustomersRepository,
  type CustomerAggregate,
  type DB,
} from '@restoran-pos/db';
import type { IncomingCallEvent } from '@restoran-pos/shared-types';

/**
 * Caller ID popup telafisi — ADR-016 §11 (S104).
 *
 * PROBLEM: `caller.incoming` emit'i fire-and-forget'tir. İstasyon (kasa) sekmesinin
 * socket'i o an kopuksa (PC/ekran uykuya girer, ağ boşta kalır) emit KAYBOLUR ve
 * yeniden bağlanınca oynatılmaz → çağrı `call_log`'a yazılır ama popup açılmaz
 * ("kayıtta numara var, popup yok" — canlı bulgu 2026-07-23).
 *
 * ÇÖZÜM: istasyon socket'i yeniden bağlanınca (handshake) son cevapsız çağrıyı
 * tekrar emit et (ürün sahibi kararı S104: yalnız EN SON, ~5 dk penceresi).
 * İstemci ek koda gerek duymaz — mevcut `caller.incoming` handler'ı aynı işler;
 * çift-popup olmaz çünkü kaynak `status='ringing'` FİLTRESİDİR (kullanıcı gördüyse
 * status dismissed/opened_order olurdu → dönmez).
 */

/**
 * Ortak müşteri→olay eşlemesi. Bridge endpoint (`caller-id/index.ts`) ile telafi
 * yolu AYNI şekli üretsin diye tek yerde; drift önlenir.
 */
export function toIncomingCallCustomer(
  customer: CustomerAggregate | null,
): IncomingCallEvent['customer'] {
  if (customer === null) return null;
  return {
    id: customer.id,
    fullName: customer.full_name,
    isBlacklisted: customer.is_blacklisted,
    totalOrders: customer.total_orders,
    addresses: customer.addresses.map((a) => ({
      id: a.id,
      title: a.title,
      addressLine: a.address_line,
      district: a.district,
      neighborhood: a.neighborhood,
      addressNote: a.address_note,
      isDefault: a.is_default,
    })),
  };
}

/**
 * Son `withinSeconds` içindeki EN SON hâlâ-ringing çağrıyı tam `IncomingCallEvent`
 * olarak kurar (müşteri + adresler dahil, bridge ile birebir). Yoksa null.
 */
export async function buildMostRecentPendingCall(
  db: Kysely<DB>,
  tenantId: string,
  withinSeconds: number,
): Promise<IncomingCallEvent | null> {
  const call = await createCallLogsRepository(db).findMostRecentRinging(
    tenantId,
    withinSeconds,
  );
  if (call === null) return null;
  const customer = await createCustomersRepository(db).findCustomerByPhone(
    tenantId,
    call.normalized_phone,
  );
  return {
    callLogId: call.id,
    // raw_phone nullable; normalized_phone NOT NULL (Migration şeması) → fallback.
    rawPhone: call.raw_phone ?? call.normalized_phone,
    normalizedPhone: call.normalized_phone,
    customer: toIncomingCallCustomer(customer),
    receivedAt: new Date(call.received_at).toISOString(),
  };
}
