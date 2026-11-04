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
import { TILE_H_PADDING, computeAndroidTileLayout } from './categoryGridLayout';

interface CategoryGridProps {
  categories: Category[];
  selectedId: string | null;
  onSelect: (categoryId: string) => void;
}

const IS_ANDROID = Platform.OS === 'android';

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
 * 🔧 **S148 (2026-11-04) — 4 sütun 3'e indirildi, [USER] kararı.** Garsonun
 * telefonu iki ay boyunca eski bir APK'da donduğu için bu dal cihazda hiç
 * görülmemişti. Görülünce ölçüldü: 4 sütunda hesaplanan font, 360-428dp
 * aralığının TAMAMINDA `MIN_FONT`'a (6px) çakılıyordu — iOS'un 15px'inin
 * %40'ı, okunmuyordu. Sebep regresyon değil, kurgunun kendisi: 9 harfli bir
 * kelimeyi 89px'lik döşemeye tek satırda sığdırmak 6px gerektiriyor. Tek
 * kaldıraç sütun sayısıydı; 3'te font 7-11px'e çıkar. 2 sütun iOS'la eşit
 * okunurluk verirdi (14px) ama 14 kategori 7 satır olup sipariş ekranını
 * kaplıyordu — [USER] 3'ü seçti.
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
    const layout = computeAndroidTileLayout(windowWidth);
    tileWidthStyle = { width: layout.tileWidth };
    fontSize = layout.fontSize;
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
