import { logger } from '../logger.js';
import { captureError } from './sentry.js';

/**
 * ADR-041 Amendment 7 **Düzeltme 1 (3b)** — fire-and-forget gözlem yazımlarında
 * `rowCount === 0` dedektörü.
 *
 * NEDEN VAR: Amd7 K5/K8 başlangıçta *"sarım eksik kalırsa `42501` doğrudan
 * `catch`'e düşer"* varsayıyordu. Bu **ampirik olarak yanlıştır** (`pos_test`,
 * `app_tenant`, `current_user` teyitli ölçüm):
 *
 * | senaryo              | UPDATE                 | SELECT   |
 * |----------------------|------------------------|----------|
 * | context YOK          | hata YOK, rowCount = 0 | 0 satır  |
 * | context yanlış tenant| hata YOK, rowCount = 0 | 0 satır  |
 * | context doğru        | rowCount = 1           | 1 satır  |
 * | context YOK + INSERT | **42501**              | —        |
 *
 * Yani force-RLS'te policy'nin `USING` yüklemi satırı **görünmez** kılar;
 * UPDATE/DELETE/SELECT hata fırlatmaz, komut "0 satır" ile BAŞARIYLA döner.
 * `42501` yalnız `WITH CHECK` ihlalinde (INSERT / UPDATE'in ürettiği satır)
 * veya eksik tablo GRANT'inde gelir. Dolayısıyla `catch` dalı eksik sarımı
 * **yakalayamaz** — bu fonksiyon o boşluğu kapatır.
 *
 * YANLIŞ-POZİTİF ANALİZİ (çağrı yerlerinin ikisi için de geçerli): her iki
 * yazım da `requireAgentJwt` agent satırını **aynı tenant context'inde**
 * SELECT edip bulduktan sonra koşar (bulamazsa istek 401 ile döner).
 * Dolayısıyla 0 satırın tek yapısal açıklaması **context kaybıdır**.
 * - revoke edilmiş agent → bu UPDATE'ler `revoked_at` filtrelemez → 1 satır
 * - aynı değeri yazmak → Postgres eşleşen satırı güncellenmiş sayar → 1 satır
 * - DB sarsıntısı (bağlantı/GRANT/deadlock) → **fırlatır** → `catch` dalı
 * - SELECT ile UPDATE arasında satırın silinmesi → 0 satır. **Tek gerçek
 *   yanlış-pozitif budur ve TEK SEFERLİKTİR** (sonraki poll `401
 *   AGENT_REVOKED` alır); eksik sarım ise HER poll'da tetiklenir. Sentry aynı
 *   mesajı tek issue'da grupladığı için ikisi **sayaçtan** ayırt edilir:
 *   `1` ↔ binlerce.
 *
 * @returns alarm üretildiyse `true` (yalnız test/çağrı-yeri gözlemi için).
 */
export function reportIfNoRowsUpdated(
  rows: ReadonlyArray<{ numUpdatedRows: bigint }>,
  context: { readonly site: string; readonly agentId: string },
): boolean {
  const updated = rows[0]?.numUpdatedRows ?? 0n;
  if (updated !== 0n) return false;

  const msg = `${context.site} 0 satır güncelledi — tenant context kaybı şüphesi (ADR-041 Amd7 Düzeltme 1)`;
  logger.error({ agentId: context.agentId }, msg);
  // `captureError` ADR-040'ın `beforeSend` + `deepRedact` PII kapısından geçer;
  // mesaj sabittir, agent id yalnız yerel pino log'una gider (Sentry event'ine
  // DEĞİL) — güvenlik denetiminin (S135) doğruladığı sınır korunur.
  captureError(new Error(msg));
  return true;
}
