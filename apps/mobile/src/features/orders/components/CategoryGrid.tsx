import type { Category } from '@restoran-pos/shared-types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  categoryPastels,
  colors,
  minTouchTarget,
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

/**
 * Category tab grid (ADR-026 Amendment 4 K4 — S99 pastel revision).
 *
 * Content-sized "chip" tiles (bkz. aşağıdaki canlı bug notu — dördüncü tur):
 * her döşeme KENDİ metninin genişliğine göre otomatik boyutlanır (sabit
 * eşit-genişlikli N-sütun DEĞİL). Kısa isimler ("TATLI") dar, uzun isimler
 * ("IZGARA ÇEŞİTLERİ") geniş kalır; `flexWrap` satıra sığdığı kadar
 * kategoriyi yan yana dizer. Kutu her zaman kendi metninden GENİŞ olduğu
 * için kelime ortasından kırılma yapısal olarak imkânsızdır — platform/font
 * metriğine göre piksel tahmini yapmaya hiç gerek kalmaz, geniş ekranlarda
 * (S25 Ultra gibi) da otomatik olarak daha fazla kategori yan yana sığar.
 * Pastel fills (Adisyo reference; category data has no distinct colours, so
 * tiles cycle a fixed palette by position). The selected tile lifts to a
 * white, shadowed card with a dark underline (reference parity). Tap targets
 * clear the HCI min (`minTouchTarget`).
 *
 * 🐛 Canlı bug fix (2026-08-04, Galaxy S25 Ultra, yalnız Android'de) — sabit
 * `width:'31.5%'` (3 sütun) Android'in Roboto Bold'unda uzun tek-kelimelik
 * kategori adlarını ("SALATALAR", "İÇECEKLER") KELİMENİN ORTASINDAN
 * kırıyordu; ayrıca sütun sayısı ekran genişliğinden bağımsız sabitti.
 *
 * 🐛 Canlı bug fix (2026-08-05, tüm platformlar) — takip eden dinamik-sütun
 * fix'i `tileWidth`'i `100/numColumns` YÜZDESİ olarak hesaplıyordu ama bu
 * container'ın `gap` boşluğunu saymıyordu, taşma flexbox'ı bir sütunu alt
 * satıra itiyordu.
 *
 * 🐛 Canlı bug fix (2026-08-05, ikinci tur) — gap düzeldikten sonra bile
 * kırılma devam etti: gerçek Android Roboto Bold render genişliği
 * tahminlerden belirgin ölçüde büyük çıktı (144px "LAHMACUN"ı taşıyamadı).
 *
 * 🐛 Canlı bug fix (2026-08-05, üçüncü tur — iki alt-deneme) — (a)
 * `adjustsFontSizeToFit` + `numberOfLines>1` Android'de güvenilir çalışmadı
 * (bilinen RN sınırlaması, metin küçülmeden aynı noktadan kırılmaya devam
 * etti); (b) platforma özel sabit genişlik/font (iOS 118px/3 sütun, Android
 * 155px/2 sütun) kırılmayı çözdü AMA Android'de yalnız 2 kategori yan yana
 * sığdığından ekranı gereksiz kaplıyordu — kullanıcı 3-4 kategori istedi.
 * Kök sorun hep AYNIYDI: "N eşit sütuna zorla sığdır" modeli, N ne olursa
 * olsun, uzun bir kategori adı için bir gün tekrar dar kalabilir (yeni dil,
 * yeni kategori adı, yeni cihaz). Fix (bu tur): sabit sütun modeli TAMAMEN
 * kaldırıldı, içerik-bazlı esnek chip düzenine geçildi (yukarı bkz.) — bu,
 * platform/font/dil ne olursa olsun kırılmayı yapısal olarak imkânsız kılan
 * TEK kalıcı çözüm.
 */
export function CategoryGrid({
  categories,
  selectedId,
  onSelect,
}: CategoryGridProps): React.JSX.Element {
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
  },
  tile: {
    // Genişlik artık içeriğe göre kendiliğinden (bkz. yukarısı) — yalnız bir
    // asgari genişlik (dokunma hedefi) ve dolgu tanımlanır, metin tek satırda
    // sığmıyorsa (aşırı uzun kombinasyonlar) doğal olarak sarar.
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
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
    fontSize: typography.fontSize.md,
    fontWeight: typography.weight.bold,
    color: colors.textPrimary,
    textAlign: 'center',
  },
});
