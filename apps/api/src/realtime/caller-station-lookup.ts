import type { Kysely } from 'kysely';
import {
  createTenantSettingsRepository,
  withTenant,
  type DB,
} from '@restoran-pos/db';

/**
 * Caller ID istasyon çözümlemesi — ADR-016 §11.
 *
 * Socket.IO handshake'i, bağlanan kullanıcının o tenant'ın "caller-ID istasyonu"
 * (kasa) olup olmadığını bilmek zorundadır; öyleyse socket `caller.incoming`
 * odasına alınır. Bu lookup GEÇİLMEZSE handshake'teki join bloğu hiç çalışmaz →
 * `emitIncomingCall` hep BOŞ odaya gider → popup yapısal olarak ölü (S86 canlı
 * bulgusu; #301 io-wiring'in kardeşi).
 *
 * ADR-041 F4d — `tenant_settings` RLS'e alındı. Bu okuma handshake içinde,
 * hiçbir transaction'ın altında DEĞİL → `withTenant` ZORUNLU. Sarılmazsa politika
 * satırı gizler, fonksiyon `null` döner ve popup yukarıdaki S86 hatasıyla AYNI
 * şekilde **sessizce** ölür: exception yok, log yok, yalnız hiç açılmayan popup.
 *
 * Neden `index.ts`'te inline değil de ayrı modül: bootstrap wiring'i (index.ts)
 * unit-test edilemez — `realtime.test.ts` prod lookup'ının saf bir mock'unu
 * kullanıyor, yani inline hâlinde bu sarım SIFIR regresyon korumasına sahipti
 * (F4d QA kapısı bulgusu). Ayrı modül olarak `app_tenant` altında doğrudan
 * test edilebilir — kardeşi `pending-caller-replay.ts` ile aynı desen.
 */
export async function resolveCallerStationUserId(
  db: Kysely<DB>,
  stationTenantId: string,
): Promise<string | null> {
  return withTenant(db, stationTenantId, async (trx) => {
    const settings =
      await createTenantSettingsRepository(trx).findByTenantId(stationTenantId);
    return settings?.caller_id_station_user_id ?? null;
  });
}
