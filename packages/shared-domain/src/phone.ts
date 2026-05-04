/**
 * Türkiye telefon numarası normalizasyonu — ADR-016 §11.
 *
 * v3 davranış paritesi (referans: `D:/dev/restoran-pos-v3/server/utils/phoneNormalize.js`,
 * READ-ONLY — kod kopyalanmadı, davranış aynen yeniden yazıldı).
 *
 * Hedef format (cep): `0XXXXXXXXXX` (11 hane, 0 ile başlar, GSM `5` prefix).
 * Sabit hat / kısa numara / yabancı: rakamları aynen, format değişmez.
 *
 * UNIQUE eşleştirmesi (`customer_phones.normalized_phone`) bu fonksiyonun
 * çıktısı üzerinden yapılır — backend her INSERT/SEARCH öncesi çağırır.
 */
export function normalizePhoneTr(input: string | null | undefined): string {
  if (input == null || input === '') return '';
  const digits = String(input).replace(/\D/g, '');
  if (digits.length === 0) return '';

  // 12 hane: 905XXXXXXXXX → 05XXXXXXXXX
  if (digits.length === 12 && digits.startsWith('905')) {
    return '0' + digits.slice(2);
  }

  // 13+ hane (örn. yanlış girilmiş +90 905..., uzun PBX prefix): 90 strip,
  // sonraki 10 hane GSM `5` ile başlıyorsa cep formatla.
  if (digits.length > 12 && digits.startsWith('90')) {
    const stripped = digits.slice(2, 12);
    if (stripped.startsWith('5') && stripped.length === 10) {
      return '0' + stripped;
    }
  }

  // 11 hane: 05XXXXXXXXX (zaten doğru format)
  if (digits.length === 11 && digits.startsWith('05')) {
    return digits;
  }

  // 10 hane: 5XXXXXXXXX → 05XXXXXXXXX
  if (digits.length === 10 && digits.startsWith('5')) {
    return '0' + digits;
  }

  // Sabit hat (7 hane lokal), kısa servis (112), yabancı vb. — rakamlar aynen.
  return digits;
}

/**
 * Türk GSM cep numarası kontrolü — normalize edilmiş `0XXXXXXXXXX` formatında
 * `5` ile başlayan 10 hanelik gövdeyi doğrular. Sabit hat / kısa numara false.
 */
export function isTurkishMobile(input: string | null | undefined): boolean {
  return /^05\d{9}$/.test(normalizePhoneTr(input));
}
