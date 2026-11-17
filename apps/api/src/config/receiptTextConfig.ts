/**
 * ADR-045 K9 kademe 3 — fiş metni GLOBAL kill-switch'i (`RECEIPT_TEXT_ENABLED`).
 *
 * Kapalıyken (`false`) çözümleyici `tenant_settings`'teki fiş metni kolonlarını
 * HİÇ dikkate almaz ve paket fişinin otomatik baskı anahtarı `true` sayılır →
 * her işletme bugünkü fişi basar. DB erişimi gerektirmez; değiştirmek API'nin
 * yeniden başlatılmasını ister (env süreç açılışında yüklenir — saniyeler, baskı
 * kuyruğu kalıcı olduğu için o pencerede düşen fiş kaybolmaz).
 *
 * Yanlış yazılmış bir değer (ör. `flase`) AÇILIŞTA reddedilir
 * (`assertReceiptTextConfig()` `src/index.ts`'ten çağrılır): bir yazım hatası
 * operatörün "kapattım" sandığı anahtarı sessizce açık bırakmasın.
 * Desen: `authConfig.ts`.
 */

/**
 * Ham env değerini anahtar durumuna çevirir.
 * @param raw `RECEIPT_TEXT_ENABLED` (tanımsız/boş → açık).
 * @throws Error — `true`/`false` dışında bir değerde.
 */
export function resolveReceiptTextEnabled(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim().length === 0) return true;
  const value = raw.trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(
    `RECEIPT_TEXT_ENABLED gecersiz: "${raw}" ("true" veya "false" bekleniyor; bos = acik)`,
  );
}

/**
 * Geçerli durum. Her çağrıda env okunur (test edilebilirlik; maliyet ihmal edilebilir).
 *
 * ⚠️ Dürüst sınır (security-reviewer, 2026-11-17): bu çağrı geçersiz bir
 * değerde THROW EDER. İstek anında buna ulaşılamaz, çünkü açılışta
 * `assertReceiptTextConfig()` aynı değeri reddeder ve çalışan sürecin env'i
 * dışarıdan değişmez — yalnız süreç İÇİNDE `process.env` yazan bir kod bunu
 * tetikleyebilir. "Fiş yolu asla throw etmez" iddiası bu varsayıma dayanır.
 */
export function isReceiptTextEnabled(): boolean {
  return resolveReceiptTextEnabled(process.env['RECEIPT_TEXT_ENABLED']);
}

/** Açılışta fail-fast doğrulama. Geçersiz yapılandırmada throw eder. */
export function assertReceiptTextConfig(): void {
  isReceiptTextEnabled();
}
