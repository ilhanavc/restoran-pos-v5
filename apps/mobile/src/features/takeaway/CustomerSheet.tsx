import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  minTouchTarget,
  radius,
  spacing,
  typography,
} from '../../theme';
import { CustomerStep } from './CustomerStep';

interface CustomerSheetProps {
  visible: boolean;
  /**
   * Zaten seçili müşterinin adı (K5): sheet tekrar açıldığında garson kimin
   * seçili olduğunu başlıkta görür, "seçtim mi seçmedim mi" tereddüdü doğmaz.
   */
  selectedName: string | null;
  onSelect: (customer: { id: string; fullName: string }) => void;
  onClose: () => void;
}

/**
 * Paket akışı — müşteri seçimi **sheet**'i (ADR-039 Amendment 1 K2).
 *
 * Tam-ekran bir adım DEĞİLDİR. Gerekçe (Amd1 K2): ürün adımı ekranın kökü
 * olunca "geri" tek anlama gelir (akıştan çık); sepet arka planda görünür
 * kalır; müşteri → ödeme zinciri aynı yüzey dilinde ilerler. Web'de karşılığı
 * `CustomerPickerModal`'dır.
 *
 * İçerik `CustomerStep`'ten **yeniden kullanılır** — ikinci bir müşteri arama
 * bileşeni yazmak yasaktır (Amd1 K2, ADR-039 K5 adım 3 ile aynı gerekçe).
 *
 * Yükseklik yüzde olarak SARMALAYICIDA verilir ([[feedback_rn_modal_layout_traps]]):
 * `CustomerStep` içindeki `FlatList` sınırlı bir yükseklik olmadan kaydırılamaz.
 */
export function CustomerSheet({
  visible,
  selectedName,
  onSelect,
  onClose,
}: CustomerSheetProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerTexts}>
              <Text style={styles.title}>
                {t('takeaway.header.customerStep')}
              </Text>
              {selectedName !== null ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {selectedName}
                </Text>
              ) : null}
            </View>
            <Pressable
              style={styles.iconButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </Pressable>
          </View>

          {/* Sepet bu sheet kapanınca KORUNUR: kapatma yalnız görünürlüğü
              değiştirir, sepet store'una (useCart) hiç dokunmaz (Amd1 K5). */}
          <CustomerStep onSelect={onSelect} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    height: '85%',
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    // Yatay dolgu BAŞLIKTA verilir: içerik (`CustomerStep`) kendi dolgusunu
    // taşır, sheet'e ikinci bir dolgu eklenirse arama kutusu daralır.
    paddingHorizontal: spacing.md,
  },
  headerTexts: {
    flex: 1,
  },
  title: {
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
  },
  iconButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
