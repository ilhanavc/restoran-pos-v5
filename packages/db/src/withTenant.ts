import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from './generated.js';

/**
 * ADR-041 (Tenant İzolasyon — Defense-in-Depth) Faz 1 altyapısı.
 *
 * Verilen `tenantId` için tek bir Kysely transaction açar ve **ilk statement**
 * olarak `set_config('app.current_tenant_id', $tenantId, true)` çalıştırır; sonra
 * callback'i o transaction (`trx`) ile koşar. F2+'da bu tablo-bazlı RLS
 * policy'lerinin (`USING (tenant_id = nullif(current_setting('app.current_tenant_id',
 * true), '')::uuid)`) besleneceği tek mekanizmadır.
 *
 * KRİTİK — pool-sızıntısı footgun'ı (ADR-041 §"Tenant context enjeksiyonu"):
 * Üçüncü argüman `is_local = true` olduğu için değer YALNIZ bu transaction'a
 * bağlıdır ve `COMMIT`/`ROLLBACK`'te otomatik sıfırlanır → client havuza temiz
 * döner. ASLA session-level `SET` / plain `SET app.current_tenant_id`
 * KULLANMA — pooled bir client bir sonraki isteğe kirli tenant context'iyle
 * dönerse felaket cross-tenant sızıntı olur.
 *
 * SÖZLEŞME — `tenantId` yalnız `req.tenantId` (yani JWT'den türeyen
 * `authenticate.ts` → `req.user.tenantId`) kaynağından gelmelidir; route'lar
 * tenantId'yi elle set edemez. Geçersiz/boş tenantId fail-fast reddedilir ki
 * context asla kirlenmesin (fail-closed).
 *
 * Faz 1 kapsam notu: bu helper F1'de tanımlanır ama HİÇBİR handler henüz buna
 * çevrilmez ve HİÇBİR tabloda RLS policy yoktur → davranış birebir aynıdır.
 * Handler entegrasyonu ve RLS ENABLE/policy F2+ fazlarındadır.
 *
 * @param db        Top-level Kysely<DB> instance (per-request değil).
 * @param tenantId  Geçerli UUID; kaynağı yalnız `req.tenantId`.
 * @param fn        Transaction (`trx`) ile koşacak iş; dönüş değeri geçirilir.
 * @throws {TypeError} tenantId boş veya geçerli bir UUID değilse (transaction
 *                     hiç açılmaz — context kirlenmez).
 */
export async function withTenant<T>(
  db: Kysely<DB>,
  tenantId: string,
  fn: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  if (!isValidUuid(tenantId)) {
    // Fail-closed: geçersiz context'le transaction AÇMA. set_config'e
    // ulaşmadan reddet — kirli/eksik tenant context ihtimalini kökten kes.
    throw new TypeError('withTenant: tenantId geçerli bir UUID olmalı');
  }

  return db.transaction().execute(async (trx) => {
    // İlk statement — is_local=true (üçüncü arg): COMMIT/ROLLBACK'te sıfırlanır.
    await sql`select set_config('app.current_tenant_id', ${tenantId}, true)`.execute(trx);
    return fn(trx);
  });
}

/**
 * RFC 4122 UUID biçim doğrulaması (versiyon-agnostik: 8-4-4-4-12 hex).
 * `set_config` değerini `::uuid`'e cast eden RLS policy'lerini beslemeden önce
 * biçimi burada garanti ederiz.
 */
function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
