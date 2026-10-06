import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { logger } from '../logger.js';
import { captureError } from '../observability/sentry.js';

/**
 * ADR-041 Amendment 7 Karar 4 — **sunset guard** (M6).
 *
 * Bu kod tabanında auth tenant-çözümü üç yerde **sunucu sabitine** bağlıdır:
 *   1. `routes/auth.ts` login — `findByEmail(deps.tenantId, …)`
 *   2. `auth/refresh.ts` rotasyon — F4e-2 (Amd7 K4(1))
 *   3. `routes/print-jobs.ts` agent register — `deps.tenantId` prefix eşleşmesi
 *
 * Varsayım yalnız yorum satırına yazılırsa, tenant #2'yi ekleyen kişi bu üç
 * yolun sessizce **yanlış tenant'a** bağlandığını fark etmez — Amd7'nin
 * düzelttiği hatanın (bkz. Amd2 Karar 2) aynısı, yeni kılıkta. Bu yüzden
 * açılışta `tenants` tablosu sayılır ve birden fazla satır varsa alarm çalar.
 *
 * ⚠️ **API DURDURULMAZ.** İkinci tenant'ı eklemek meşru bir iştir; amaç
 * engellemek değil, **sessizliği kırmaktır**. (M4/M5 fail-fast'tır çünkü
 * oradaki durum her zaman yanlış yapılandırmadır; burada durum "yapılacak iş
 * var" demektir.)
 *
 * Kalıntı risk (bilinçli kabul): guard yalnız **tenant sayısını** görür,
 * yanlış **eşleşmeyi** görmez. Yani üç çağrı noktası tenant #2 için
 * güncellenmemiş olsa bile, tenants tablosunda tek satır kaldığı sürece
 * sessizdir.
 *
 * Yeni env / rol / GRANT gerektirmez: `app_tenant`'ın `tenants` üzerindeki
 * SELECT yetkisi Amd5 (mig 063) ile canlıdır ve `tenants` tablosu RLS'e tabi
 * değildir.
 */
export async function warnIfMultiTenant(db: Kysely<DB>): Promise<void> {
  try {
    const result = await sql<{ n: string }>`
      select count(*)::text as n from public.tenants where deleted_at is null
    `.execute(db);
    const count = Number(result.rows[0]?.n ?? '0');
    if (count > 1) {
      const message =
        'ADR-041 Amd7 K4 sunset koşulu tetiklendi: auth tenant-çözümü tek-tenant sabitine bağlı';
      logger.error({ tenantCount: count }, `[api] M6: ${message}`);
      // ADR-040 — `captureError` tek çıkış kanalıdır (`captureMessage` gibi
      // ikinci bir export bilinçli olarak eklenmedi); event `beforeSend` →
      // PII temizleme kapısından geçer.
      captureError(new Error(message));
      return;
    }
    logger.info(
      { tenantCount: count },
      '[api] M6 OK: tek tenant — auth tenant-çözümü sabiti geçerli',
    );
  } catch (err) {
    // Guard bir **alarm**dır, ön-koşul değil: sayım başarısız olursa API
    // açılmaya devam eder (aksi halde gözlem aracı bir kesinti kaynağına
    // dönüşür). Hata yine görünür olur.
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[api] M6: tenant sayımı başarısız — sunset guard bu açılışta doğrulanamadı',
    );
  }
}
