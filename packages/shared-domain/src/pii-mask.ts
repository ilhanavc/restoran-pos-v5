/**
 * PII maskeleme yardımcıları — ADR-021 (Sprint 14 PR-4a).
 *
 * KVKK uyumu için CSV export'larda telefon, müşteri adı ve adres alanları
 * **mecburi** maskelenir. Saf fonksiyonlar (yan etki yok, framework-free).
 *
 * Üç ayrı fonksiyon — her PII alan tipi farklı format kuralı izler. Tek bir
 * generic mask kullanmak telefon (digit format) + ad (kelime split) + adres
 * (semantik mahalle ayrımı) gibi heterojen vakalar için uygun değil.
 */

/**
 * Telefon numarasını `XXX***YYYY` formatına maskeler — ilk 3 hane + son 4 hane,
 * ortası `***`. Boşluk / `+90` / parantez gibi non-digit karakterler strip edilir
 * (`phone.ts::normalizePhoneTr` ile aynı temizlik mantığı; ama burada normalize
 * yapılmaz, sadece digit-only çıkarılır — orijinal numara formatı CSV'de zaten
 * normalize edilmiş halde gelir varsayılır).
 *
 * Yetersiz girdi (7 haneden kısa, null, boş) → `'***'` fallback. Bu, tek bir
 * "maskeli ama veri yok" sentineline indirger ve CSV consumer'da branching'i
 * azaltır.
 */
export function maskPhoneForExport(phone: string | null | undefined): string {
  if (phone == null || phone === '') return '***';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 7) return '***';
  const head = digits.slice(0, 3);
  const tail = digits.slice(-4);
  return `${head}***${tail}`;
}

/**
 * Müşteri adını maskeler:
 * - Tek kelime → tam isim döner (mask yok; soyad bilinmediği için)
 * - İki+ kelime → `<ilk_isim> <soyad_ilk_harfi>***`
 *
 * Birden fazla soyad/orta isim varsa yalnız **ilk** soyad parçasının ilk harfi
 * kullanılır (ör. "Ahmet Kaya Yılmaz" → "Ahmet K***"). Bu KVKK pratik dengesi:
 * tam soyad ifşa etmez, ama destek/tartışmalı vakalar için kim olduğunu hatırlatır.
 *
 * Boş / null → boş string (CSV'de `''` cell, hücre boş kalır — operator için
 * "müşteri kaydı yok" semantiği `***`'tan ayrı bir sinyal).
 */
export function maskCustomerName(name: string | null | undefined): string {
  if (name == null) return '';
  const trimmed = String(name).trim();
  if (trimmed === '') return '';
  // Birden fazla boşluk tolere — split ile filtrelenir.
  const parts = trimmed.split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 1) return parts[0]!;
  const firstName = parts[0]!;
  const lastInitial = parts[1]!.charAt(0);
  return `${firstName} ${lastInitial}***`;
}

/**
 * Adres alanını mahalle düzeyine maskeler — sokak / kapı no / daire içeren
 * baş kısım atılır, mahalle başlangıcı + kalan parçalar (ilçe, il) korunur.
 *
 * Heuristik:
 * 1. Virgül ile parçala (TR adres formatı: "Sokak No, Mahalle, İlçe/İl")
 * 2. "Mah." veya "Mahallesi" geçen ilk parçayı bul
 * 3. O parçadan itibaren string'in geri kalanı döner (parça aralarındaki virgül
 *    ve boşluklar orijinal formatta korunur — sadece prefix kesilir)
 * 4. Mahalle keyword'ü hiç yoksa boş string (mahalle bilinmediği için
 *    operasyonel değer yok; sokak gizleme tek başına yeterli mask değil)
 *
 * Türkçe karakter güvenli — case-insensitive arama (`Mah.`, `MAH.`, `mahallesi`
 * hepsi eşleşir). "Mahallesi" prefix'i `Mah.`tan önce test edilir; çünkü `Mah.`
 * pattern'i "Mahallesi" içinde de eşleşir (ilk match ikincisini kapsar).
 */
export function maskAddress(address: string | null | undefined): string {
  if (address == null) return '';
  const trimmed = String(address).trim();
  if (trimmed === '') return '';

  // Mahalle keyword'ünün karakter offset'ini bul (case-insensitive).
  // İki olası bitiş: "Mahallesi" (uzun form) veya "Mah." (kısa form).
  // Uzun form önce — "Mahallesi" 4. harften sonra "Mah." substring'i içerir,
  // kısa form match'i prematüre kesim yapardı.
  const lower = trimmed.toLocaleLowerCase('tr-TR');
  const longIdx = lower.indexOf('mahallesi');
  const shortIdx = lower.indexOf('mah.');

  // Hangi keyword içinde mahalle parçasını bulduğumuzu belirle.
  // Geçerli match: keyword'ten önce kelime sınırı (boşluk veya başlangıç) olmalı —
  // "muhtemel" gibi false positive'leri eler. Basit kontrol: önceki char yok veya boşluk/virgül.
  const isWordBoundary = (idx: number): boolean => {
    if (idx <= 0) return true;
    const prev = trimmed.charAt(idx - 1);
    return /[\s,]/.test(prev);
  };

  let keywordIdx = -1;
  if (longIdx !== -1 && isWordBoundary(longIdx)) {
    keywordIdx = longIdx;
  } else if (shortIdx !== -1 && isWordBoundary(shortIdx)) {
    keywordIdx = shortIdx;
  }

  if (keywordIdx === -1) return '';

  // Keyword'ün ait olduğu virgül-parçasının başlangıcına geri yürü.
  // "Atatürk Cad. No:12, Kızılay Mah., Çankaya/Ankara" → "Kızılay Mah." parçasının
  // başına dön (önceki virgül + boşluk sonrası).
  let segmentStart = trimmed.lastIndexOf(',', keywordIdx);
  if (segmentStart === -1) {
    segmentStart = 0; // mahalle baştaki parçadaysa string'in başına git
  } else {
    segmentStart += 1; // virgülden bir sonraki char
    // Virgül sonrası boşluk(lar)ı atla
    while (
      segmentStart < trimmed.length &&
      /\s/.test(trimmed.charAt(segmentStart))
    ) {
      segmentStart += 1;
    }
  }

  return trimmed.slice(segmentStart);
}
