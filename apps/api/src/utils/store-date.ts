/**
 * Business date helper'ları.
 *
 * `store_date` ADR-003 §11 gereği DB-otoritatif `business_date`'in vekili.
 * MVP'de cutoff hour yok (Phase 4'te tenant_settings'ten gelecek).
 *
 * Gün sınırı TENANT TIMEZONE'a göredir (DB trigger `populate_order_store_date`
 * ile hizalı — o da `created_at + tenant_settings.timezone`dan hesaplar).
 * Eski UTC-midnight davranışı İstanbul'da 00:00-03:00 penceresinde önceki
 * günü döndürüyordu (denetim R7-TZ-11): gece yarısından sonra GET /orders
 * default'u dünkü siparişleri gösteriyordu.
 */

/**
 * Verilen IANA timezone'da bugünün tarihi — DATE kolonu semantiğiyle
 * (UTC-midnight Date; pg DATE'e cast'te yalnız Y-M-D kısmı kullanılır).
 * Çağıran tenant tz'yi `tenant_settings.timezone`dan verir (print-enqueue
 * deseni). Geçersiz tz Intl tarafından RangeError fırlatır — config hatası
 * sessizce yanlış güne düşmesin diye kasıtlı yakalanmıyor (tenant_settings
 * DB trigger'ı IANA-doğrulamalı, pratikte geçersiz değer giremez).
 */
export function todayStoreDate(timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()); // en-CA → "YYYY-MM-DD"
  return new Date(`${parts}T00:00:00.000Z`);
}

/**
 * `YYYY-MM-DD` query parametresini UTC midnight Date'e çevirir.
 * Format doğrulaması zod schema seviyesinde yapılmalı (regex /^\d{4}-\d{2}-\d{2}$/).
 * Tz-güvenli: kullanıcı EXPLICIT tarih verir; DATE kolonuna cast'te yalnız
 * Y-M-D kullanıldığından UTC-midnight temsili doğrudur (R7-CSV-04 notu).
 */
export function parseDateParam(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}
