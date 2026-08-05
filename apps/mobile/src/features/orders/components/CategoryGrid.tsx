import type { Category } from '@restoran-pos/shared-types';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

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
// En uzun tek-kelimelik kategori adını ("SALATALAR"/"İÇECEKLER", 9 harf, bold
// büyük harf) tek satırda taşıyacak asgari döşeme genişliği — bkz. aşağıdaki
// canlı bug notu. 118 değeri bir Chrome/Segoe UI mock'undan tahmin edilmişti;
// gerçek Android Roboto Bold glif genişliği bundan belirgin ölçüde geniş
// çıktı (canlı kanıt: 144px'te bile "LAHMACUN" kırıldı). Bu yüzden asgari
// sütun sayısı 2'ye indirildi (3 zorlaması dar ekranlarda garanti kırılmaya
// yol açıyordu) ve değer geniş bir güvenlik payıyla yükseltildi.
const MIN_TILE_WIDTH = 155;
const MIN_COLUMNS = 2;

/**
 * Category tab grid (ADR-026 Amendment 4 K4 — S99 pastel revision).
 *
 * Equal-width tiles, each filled with a distinct pastel from a fixed palette
 * cycled by position (Adisyo reference; category data has no distinct colours,
 * so the palette is deterministic and data-independent). The pastel fills make
 * categories read as their own colourful layer, clearly apart from the white
 * product cards below — this replaces the single-accent selected-fill of the
 * first Amendment 4 pass, which the user found too card-like. The selected tile
 * lifts to a white, shadowed card with a dark underline (reference parity).
 * Labels wrap freely (no `numberOfLines`) so long names never truncate; rows
 * stretch so same-row tiles stay equal height. Tap targets clear the HCI min.
 *
 * 🐛 Canlı bug fix (2026-08-04, Galaxy S25 Ultra, yalnız Android'de) — sabit
 * `width:'31.5%'` (3 sütun) iki sorun üretiyordu: (1) Android'in metin
 * kırma motoru iOS'tan daha agresif — döşeme dar kalınca uzun tek-kelimelik
 * kategori adları ("SALATALAR", "İÇECEKLER") KELİMENİN ORTASINDAN
 * bölünüyordu; (2) sütun sayısı ekran genişliğinden bağımsız sabit 3
 * olduğundan geniş ekranlarda fazladan yatay alan hiç kullanılmıyordu.
 * Fix: `OrderScreen`'in ürün-kartı sütun hesabıyla (satır ~104) aynı
 * desen — sütun sayısı `useWindowDimensions` ile EKRAN GENİŞLİĞİNE göre
 * hesaplanır (asgari 3, hedef döşeme genişliği en uzun etiketi taşıyacak
 * kadar geniş kalacak şekilde `MIN_TILE_WIDTH`).
 *
 * 🐛 Canlı bug fix (2026-08-05, tüm platformlar) — yukarıdaki fix'in kendisi
 * `tileWidth` genişliğini `100/numColumns` YÜZDESİ olarak hesaplıyordu, ama
 * bu yüzde container'ın `gap` stiliyle ayrılan boşluğu SAYMIYOR: 3 sütun ×
 * %33.3 + 2 × gap, container genişliğini aşıp flexbox'ı 3. döşemeyi alt
 * satıra itiyordu (numColumns=3 hesaplansa bile ekranda 2 sütun görünüyordu,
 * hem Android hem iOS'ta). Fix: genişlik piksel cinsinden, gap payı
 * düşülerek hesaplanır (`availableWidth`'ten `numColumns` arası boşluk
 * çıkarılıp `numColumns`'a bölünür) — HTML mock'taki `calc()` mantığının
 * birebir karşılığı.
 *
 * 🐛 Canlı bug fix (2026-08-05, ikinci tur — gerçek Android cihaz kanıtı) —
 * gap taşması düzeldikten sonra bile 3 sütunda kelime kırılması DEVAM etti:
 * gerçek Android Roboto Bold render genişliği HTML/Chrome mock'un tahmininden
 * belirgin ölçüde büyük çıktı (144px döşeme "LAHMACUN"ı taşıyamadı). Fix: hem
 * font boyutu küçültüldü (md→sm) hem `MIN_TILE_WIDTH` büyük bir güvenlik
 * payıyla yükseltildi hem de zorunlu asgari sütun sayısı 3'ten 2'ye indirildi
 * — dar telefonlarda 3 sütunu zorlamak metni garanti kırıyordu; geniş
 * ekranlarda (`MIN_TILE_WIDTH` payına sığdığında) yine 3+ sütuna çıkar.
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
    Math.floor((availableWidth + GAP) / (MIN_TILE_WIDTH + GAP)),
  );
  const tileWidth = (availableWidth - GAP * (numColumns - 1)) / numColumns;

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
            <Text style={styles.label}>{category.name}</Text>
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
    // Genişlik artık `numColumns`'a göre satır-içi (bkz. yukarısı) — burada
    // yalnız sütun-bağımsız stiller kalır. Labels wrap freely inside so long
    // names grow the tile instead of clipping. Chunky min-height for a
    // reference-like tap surface, well above the HCI touch minimum.
    minHeight: 64,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
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
    fontSize: typography.fontSize.sm,
    fontWeight: typography.weight.bold,
    color: colors.textPrimary,
    textAlign: 'center',
  },
});
