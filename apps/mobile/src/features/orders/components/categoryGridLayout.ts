import { spacing, typography } from '../../../theme';

/**
 * Android kategori ızgarası döşeme/font hesabı — SAF mantık, RN import'u YOK.
 *
 * `vitest.config.ts`'in kuralı gereği bileşenden ayrı tutulur: RN kaynaklarını
 * import eden dosyalar test edilemiyor, o yüzden kalibrasyon kararı burada
 * yaşar ve `CategoryGrid` bu fonksiyonun dışında ikinci bir koşul TAŞIMAZ.
 *
 * 🔧 **Neden ayrı bir dosya oldu (S148, 2026-11-04).** Hesap S105'ten beri
 * bileşenin içindeydi ve hiçbir test aritmetiğini kontrol etmiyordu. 4 sütunlu
 * kalibrasyonda font, 360-428dp aralığının TAMAMINDA `MIN_FONT`'a (6px)
 * çakılıyordu — iOS'un 15px'inin %40'ı. Bu iki ay görünmedi, çünkü garsonun
 * cihazı eski bir APK'da donmuştu (S146) ve dal hiç gözle görülmedi. Artık
 * `categoryGridLayout.test.ts` sabitleri mutlak eşiklerle sınar.
 */

// `OrderScreen`'in `controls` sarmalayıcısıyla AYNI yatay boşluk.
const H_PADDING = spacing.md;
const GAP = spacing.sm;
/** Döşeme içi yatay dolgu (metin alanı = tileWidth - 2*bu). Stil de kullanır. */
export const TILE_H_PADDING = spacing.xs;

// Asgari sütun sayısı — [USER] kararı (S148): Android'de 3. S105'te 4'tü;
// 4 sütunda font her telefon genişliğinde tabana çakılıyordu. 3'te font
// 7-11px'e çıkar ve sütun sayısı iOS'un 31.5%'lik üç sütunuyla hizalanır.
const MIN_COLUMNS = 3;

// Hedef döşeme genişliği — bundan geniş ekranlarda sütun sayısı 3'ün üstüne
// çıkar; tablet hâlâ ölçeklenir (600dp→4, 800dp→6).
//
// ⚠️ `MIN_COLUMNS`'u TEK BAŞINA düşürmek İŞE YARAMAZ. Sütun sayısı
// `max(MIN_COLUMNS, floor(...))` olduğu için bu değer küçük kalırsa floor()
// telefonda yine 4 döndürür ve asgari değeri ezer. Telefonda 3 sütunu garanti
// etmek için ≥ 121 olmalı (412dp'de floor(388/129) = 3). İkisi birlikte değişir.
const TARGET_TILE_WIDTH = 121;

// En uzun tek KELİME ("SALATALAR"/"İÇECEKLER"/"ÇEŞİTLERİ", 9 harf) — font
// hesabının bağlayıcı kısıtı bu, etiketin tamamı değil. Çok kelimeli adlar
// (canlıda "IZGARA ÇEŞİTLERİ" 16, "KARIŞIK IZGARA" 14 harf) boşluktan kırılıp
// `numberOfLines={2}` ile iki satıra sığar. Tek kelimelik 10+ harfli bir
// kategori eklenirse bu değer güncellenmeli.
const WIDEST_LABEL_CHARS = 9;

// Harf-başına-genişlik faktörü (px / harf / font-birimi). Roboto Bold ile
// canlıda ampirik kalibre edildi (S105 bug turları).
const CHAR_WIDTH_FACTOR = 1.35;

const MIN_FONT = 6;
const MAX_FONT = typography.fontSize.md;

export interface AndroidTileLayout {
  numColumns: number;
  tileWidth: number;
  fontSize: number;
}

/**
 * Pencere genişliğinden sütun sayısı, döşeme genişliği ve font boyunu türetir.
 * Font, en uzun tek kelime döşemeye TEK SATIRDA sığacak şekilde küçültülür —
 * kelime ortasından kırılma böylece yapısal olarak imkânsız hale gelir.
 */
export function computeAndroidTileLayout(windowWidth: number): AndroidTileLayout {
  const availableWidth = windowWidth - H_PADDING * 2;
  const numColumns = Math.max(
    MIN_COLUMNS,
    Math.floor((availableWidth + GAP) / (TARGET_TILE_WIDTH + GAP)),
  );
  const tileWidth = (availableWidth - GAP * (numColumns - 1)) / numColumns;
  const textRoom = tileWidth - TILE_H_PADDING * 2;
  const fontSize = Math.max(
    MIN_FONT,
    Math.min(MAX_FONT, Math.floor(textRoom / (WIDEST_LABEL_CHARS * CHAR_WIDTH_FACTOR))),
  );
  return { numColumns, tileWidth, fontSize };
}
