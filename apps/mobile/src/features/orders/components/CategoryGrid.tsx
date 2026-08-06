import type { Category } from '@restoran-pos/shared-types';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import {
  categoryPastels,
  colors,
  radius,
  shadow,
  spacing,
  typography,
} from '../../../theme';

interface CategoryGridProps {
  categories: Category[];
  selectedId: string | null;
  onSelect: (categoryId: string) => void;
}

// `OrderScreen`'in `controls` sarmalayıcısıyla AYNI yatay boşluk (H_PADDING).
const H_PADDING = spacing.md;
const GAP = spacing.sm;
// Döşeme içi yatay dolgu (metin için bırakılan boşluk = tileWidth - 2*bu).
const TILE_H_PADDING = spacing.xs;
// Asgari sütun sayısı — PLATFORMA ÖZEL ([USER] isteği S105): Android 4 sütun
// (kullanıcı özellikle istedi; font aşağıda küçülüp en uzun adı kırılmadan
// sığdırır), iOS 3 sütun (San Francisco fontu daha dar + kullanıcı iOS'ta 3'ü
// beğendi — 4 istemedi). Cihaz genişliği eşiği geçmese bile bu asgari
// garantilenir.
const MIN_COLUMNS = Platform.OS === 'android' ? 4 : 3;
// Hedef döşeme genişliği — PLATFORMA ÖZEL (asgari sütunla uyumlu): Android'de
// 84 (responsive hesap normal telefonlarda 4'e ulaşır), iOS'ta 118 (responsive
// hesap normal iPhone'larda 3'te kalır — MIN_COLUMNS=3 tek başına yetmez,
// çünkü 84 iOS'ta da 4 üretirdi). Bundan geniş ekranlarda sütun sayısı otomatik
// bir üste çıkar.
const TARGET_TILE_WIDTH = Platform.OS === 'android' ? 84 : 118;
// En uzun tek-kelimelik kategori adı ("SALATALAR"/"İÇECEKLER", 9 harf).
const WIDEST_LABEL_CHARS = 9;
// Harf-başına-genişlik faktörü (px / harf / font-birimi). CANLI kanıtlanmış
// yapılandırmadan türetildi: 2 sütun/360dp'de font 13 ile 9 harf ~144px metin
// alanına sorunsuz sığdı → 144/(9*13) ≈ 1.23. Güvenlik payı için 1.35
// kullanılıyor (daha büyük faktör = daha küçük/güvenli font). Bu, Chrome
// mock tahmininin aksine gerçek Android Roboto ölçümüne dayanır.
const CHAR_WIDTH_FACTOR = 1.35;
// Alt font sınırı — PLATFORMA ÖZEL: Android 4 sütun (daha dar döşeme) için
// 6'ya kadar inebilmeli; iOS 3 sütunda [USER] önceki turda onayladığı
// (PR #527) 8 değerinde kalır — bunu 6'ya düşürmek iOS'ta gereksiz yere
// küçültürdü ("dünkü ölçülerde değil" geri bildirimi).
const MIN_FONT = Platform.OS === 'android' ? 6 : 8;
const MAX_FONT = typography.fontSize.md;

/**
 * Category tab grid (ADR-026 Amendment 4 K4 — S99 pastel revision).
 *
 * Eşit-genişlikli, düzenli çok-sütunlu ızgara (asgari 3 sütun). Font boyutu
 * döşeme genişliğinden HESAPLANIR: en uzun tek-kelimelik kategori adı
 * döşemeye tek satırda sığacak şekilde küçültülür. Tüm döşemeler aynı
 * genişlikte olduğundan font da tüm ızgarada TEK ve tutarlıdır (düzenli
 * görünüm) — ama artık kelime ortasından kırılma yapısal olarak imkânsızdır,
 * çünkü font her zaman en uzun adı taşıyacak kadar küçültülür. Bu, sabit
 * font + sabit sütun modelinin tekrar tekrar ürettiği canlı kırılma turlarını
 * bitiren yaklaşım (bkz. aşağıdaki bug notları). Pastel dolgular (Adisyo
 * reference); seçili döşeme beyaz + alt-çizgi (reference parity).
 *
 * 🐛 Canlı bug turları (2026-08-04 → 08-05): (1) sabit %31.5/3 sütun Android
 * Roboto Bold'da uzun adları KELİME ORTASINDAN kırıyordu; (2) dinamik %sütun
 * `gap`'i saymayıp bir sütunu alt satıra itiyordu; (3) gap düzeldi ama gerçek
 * Roboto genişliği tahminden büyük çıkıp hâlâ kırıyordu; (4) `adjustsFontSize
 * ToFit`+`numberOfLines>1` Android'de güvenilir çalışmadı; (5) platforma özel
 * sabitler (Android 2 sütun) kırılmayı çözdü ama yalnız 2 kategori sığdırıp
 * ekranı kapladı; (6) içerik-bazlı esnek chip düzeni kırılmayı çözdü ama
 * kutular farklı genişlikte olduğu için "dağınık" göründü. KÖK ÇÖZÜM (bu):
 * düzenli eşit-sütun ızgarası KORUNUR (3+ sütun), font döşeme genişliğinden
 * canlı-kalibre faktörle hesaplanıp en uzun adı taşıyacak kadar küçültülür —
 * hem düzenli, hem kırılmasız, hem platform-bağımsız.
 */
export function CategoryGrid({
  categories,
  selectedId,
  onSelect,
}: CategoryGridProps): React.JSX.Element {
  const { width: windowWidth } = useWindowDimensions();
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

  return (
    <View style={styles.grid}>
      {categories.map((category, index) => {
        const isSelected = category.id === selectedId;
        const pastel = categoryPastels[index % categoryPastels.length];
        return (
          <Pressable
            key={category.id}
            style={[
              styles.tile,
              { width: tileWidth },
              isSelected ? styles.tileSelected : { backgroundColor: pastel },
            ]}
            onPress={() => onSelect(category.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={category.name}
          >
            <Text style={[styles.label, { fontSize }]} numberOfLines={2}>
              {category.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    // Same-row tiles stretch to the row height — equal look even when one label
    // wraps to two lines (iki kelimeli adlar boşluktan sarar).
    alignItems: 'stretch',
  },
  tile: {
    // Genişlik satır-içi (`numColumns`'a göre); yükseklik/dolgu PLATFORMA ÖZEL.
    // Android'de dikey dolgu kısıldı (S105 canlı: döşemeler dikeyde ekranı
    // kaplıyordu) — minHeight HCI dokunma-hedefi minimumunda (52pt) tutulur.
    // iOS önceki (onaylanmış, PR #527) ölçülerde kalır — bu değişiklik
    // Android'e özgü bir şikayete cevaptı, iOS'ta talep edilmemişti.
    minHeight: Platform.OS === 'android' ? 52 : 64,
    borderRadius: radius.lg,
    paddingHorizontal: TILE_H_PADDING,
    paddingVertical: Platform.OS === 'android' ? spacing.sm : spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileSelected: {
    // Selected = white raised card + dark underline (reference), so it reads as
    // "active" against the flat pastels.
    backgroundColor: colors.background,
    borderBottomWidth: 3,
    borderBottomColor: colors.slate,
    ...shadow,
  },
  label: {
    fontWeight: typography.weight.bold,
    color: colors.textPrimary,
    textAlign: 'center',
  },
});
