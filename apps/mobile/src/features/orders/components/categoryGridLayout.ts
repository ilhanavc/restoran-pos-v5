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
 *
 * ⚠️ **Dikey alan bedeli kayıt altında.** `CategoryGrid` her iki sipariş
 * ekranında da KAYDIRILMAYAN `styles.controls` başlığında duruyor (ürün
 * `FlatList`'inin üstünde). 14 kategoride ızgara yüksekliği 4 sütunda ~232px,
 * 2 sütunda ~412px — yani ürün listesi ~180px kaybeder. 14pt okunurluk bu
 * bedelle satın alındı ([USER] kararı). Izgaranın yüksekliğini sınırlayıp
 * kendi içinde kaydırmak ayrı bir karardır, bu değişiklikte YAPILMADI.
 */

// `OrderScreen`'in `controls` sarmalayıcısıyla AYNI yatay boşluk.
const H_PADDING = spacing.md;
const GAP = spacing.sm;
/** Döşeme içi yatay dolgu (metin alanı = tileWidth - 2*bu). Stil de kullanır. */
export const TILE_H_PADDING = spacing.xs;

// Asgari sütun sayısı — [USER] kararı (S148): Android'de 2. S105'te 4'tü.
//
// Neden 2: font döşeme genişliğinden türetildiği için sütun sayısı tek
// kaldıraç. `docs/hci/pos-checklist.md` satır 113 **minimum 14pt** istiyor;
// 9 harfli bir kelimenin 14pt'de kapladığı yer 170px, yani döşeme ≥ 178px —
// bu matematiksel olarak 2 sütun demek. 3 sütun 9px, 4 sütun 6px verirdi,
// ikisi de eşiğin çok altında ve kayıtlı bir istisnası yok.
const MIN_COLUMNS = 2;

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

// Sütun EKLEME eşiği — büyülü sayı değil, tasarım amacının kendisi:
// "`MAX_FONT`'un elde edilebildiği en küçük döşeme". Ekran bu genişlikte bir
// döşeme daha taşıyabiliyorsa sütun eklenir, çünkü font zaten tavanda olur ve
// eklemenin okunurluk maliyeti yoktur. Telefon 2 sütunda kalır, tablet
// ölçeklenir (800dp→3, 1024dp→5).
//
// ⚠️ `MIN_COLUMNS`'u TEK BAŞINA değiştirmek İŞE YARAMAZ. Sütun sayısı
// `max(MIN_COLUMNS, floor(...))` olduğu için bu eşik küçük kalırsa floor()
// telefonda daha fazla sütun döndürür ve asgari değeri EZER. S148'de 4→3
// denemesi tam bu yüzden tek başına etkisiz kalmıştı. İkisi birlikte değişir.
const TARGET_TILE_WIDTH =
  Math.ceil(WIDEST_LABEL_CHARS * CHAR_WIDTH_FACTOR * MAX_FONT) + TILE_H_PADDING * 2;

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
