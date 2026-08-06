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

const IS_ANDROID = Platform.OS === 'android';

// `OrderScreen`'in `controls` sarmalayıcısıyla AYNI yatay boşluk (H_PADDING) —
// yalnız Android'in döşeme-genişliği hesabı için kullanılır.
const H_PADDING = spacing.md;
const GAP = spacing.sm;
// Döşeme içi yatay dolgu (metin için bırakılan boşluk = tileWidth - 2*bu).
const TILE_H_PADDING = spacing.xs;
// Asgari sütun sayısı — [USER] isteği (S105): Android'de 4 (font aşağıda
// küçülüp en uzun adı kırılmadan sığdırır).
const MIN_COLUMNS = 4;
// Hedef döşeme genişliği — bundan geniş ekranlarda sütun sayısı 4'ün üstüne
// (5+) çıkar.
const TARGET_TILE_WIDTH = 84;
// En uzun tek-kelimelik kategori adı ("SALATALAR"/"İÇECEKLER", 9 harf).
const WIDEST_LABEL_CHARS = 9;
// Harf-başına-genişlik faktörü (px / harf / font-birimi). CANLI kanıtlanmış
// yapılandırmadan türetildi (bkz. bug notları).
const CHAR_WIDTH_FACTOR = 1.35;
const MIN_FONT = 6;
const MAX_FONT = typography.fontSize.md;

/**
 * Category tab grid (ADR-026 Amendment 4 K4 — S99 pastel revision).
 *
 * 🐛 Canlı bug turları (2026-08-04 → 08-05, S105) — Android'de "SALATALAR" /
 * "İÇECEKLER" gibi uzun tek-kelimelik adlar kelime ortasından kırılıyordu
 * (Galaxy S25 Ultra). Sırasıyla denenen fix'ler: (1) dinamik sütun sayısı;
 * (2) `gap` payını düşen piksel-genişlik hesabı; (3) gerçek Roboto Bold
 * metriğine göre yeniden kalibrasyon; (4) `adjustsFontSizeToFit` (Android'de
 * çok-satırda güvenilir çalışmadı); (5) platforma özel sabitler; (6) içerik-
 * bazlı esnek chip (kutular farklı genişlikte "dağınık" göründü). Sonunda
 * Android'de döşeme genişliğinden HESAPLANAN font'a karar verildi — en uzun
 * ad döşemeye tek satırda sığacak şekilde küçültülür, kırılma yapısal olarak
 * imkânsız hale gelir; [USER] isteğiyle ayrıca 4 sütun + kısaltılmış dikey
 * dolgu uygulandı.
 *
 * ⚠️ **iOS'a ASLA DOKUNMA** — [USER] talimatı (S105): iOS bu sorunu hiç
 * yaşamadı (San Francisco fontu Roboto'dan dar), üstündeki her "kök çözüm"
 * denemesi iOS'u gereksiz yere geriletti (sütun sayısı/font/boyut). iOS
 * kasıtlı olarak Amendment 4'ün ORİJİNAL, hiç değişmemiş sabit değerlerini
 * kullanır — cutover günü (2026-07-24) neyse hâlâ o. Android'e yapılacak
 * herhangi bir kalibrasyon değişikliği bu dosyada `IS_ANDROID` dalının
 * DIŞINA sızmamalı.
 */
export function CategoryGrid({
  categories,
  selectedId,
  onSelect,
}: CategoryGridProps): React.JSX.Element {
  // iOS: cutover-günü orijinal sabit değerler — hesaplama yok.
  const { width: windowWidth } = useWindowDimensions();
  let tileWidthStyle: { width: number | `${number}%` };
  let fontSize: number;

  if (IS_ANDROID) {
    const availableWidth = windowWidth - H_PADDING * 2;
    const numColumns = Math.max(
      MIN_COLUMNS,
      Math.floor((availableWidth + GAP) / (TARGET_TILE_WIDTH + GAP)),
    );
    const tileWidth = (availableWidth - GAP * (numColumns - 1)) / numColumns;
    const textRoom = tileWidth - TILE_H_PADDING * 2;
    tileWidthStyle = { width: tileWidth };
    fontSize = Math.max(
      MIN_FONT,
      Math.min(MAX_FONT, Math.floor(textRoom / (WIDEST_LABEL_CHARS * CHAR_WIDTH_FACTOR))),
    );
  } else {
    tileWidthStyle = { width: '31.5%' };
    fontSize = typography.fontSize.md;
  }

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
              tileWidthStyle,
              isSelected ? styles.tileSelected : { backgroundColor: pastel },
            ]}
            onPress={() => onSelect(category.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={category.name}
          >
            <Text style={[styles.label, { fontSize }]} numberOfLines={IS_ANDROID ? 2 : undefined}>
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
    // wraps to two lines.
    alignItems: 'stretch',
  },
  tile: {
    // Genişlik satır-içi (yukarı bkz.); yükseklik/dolgu PLATFORMA ÖZEL —
    // Android'de kısaltılmış ([USER] isteği S105: dikeyde ekranı kaplıyordu),
    // iOS'ta cutover-günü orijinal değerler (dokunulmadı).
    minHeight: IS_ANDROID ? 52 : 64,
    borderRadius: radius.lg,
    paddingHorizontal: IS_ANDROID ? TILE_H_PADDING : spacing.sm,
    paddingVertical: IS_ANDROID ? spacing.sm : spacing.md,
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
