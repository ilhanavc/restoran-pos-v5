import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius } from '../../../theme';

interface QtyStepperProps {
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
  /** Bottom-button icon: a minus, or a trash can when one more tap removes the line. */
  decrementIcon: 'remove' | 'trash';
  increaseLabel: string;
  decreaseLabel: string;
  /** Stretch the group to the parent's height with `+` / `−` pinned to the top
   *  and bottom corners (product-card right rail). Off = a compact stack. */
  spanHeight?: boolean;
  /**
   * `−` (veya çöp) pasif — S104: ürün kartında sayaç ADİSYONA KAYDEDİLMİŞ
   * adedi de gösterir; kayıtlı kalem karttan düşürülemez (iptal ayrı bir akış,
   * ADR-027 Amd2). Sepette düşürülecek bir şey kalmayınca buton solar ve
   * dokunma kabul etmez.
   */
  decrementDisabled?: boolean;
}

/** Pasif "−" için dokunuş-yutan boş handler (bkz. aşağıdaki `disabled` uyarısı). */
const noop = (): void => {};

const SEG = 30;
// hitSlop lifts the effective touch target to the 52pt HCI minimum
// (pos-checklist): SEG 30 + 2 × 11 = 52.
const HIT = 11;

/**
 * Vertical quantity control (ADR-026 K2) — matches the owner's reference POS: a
 * grey rounded `+` button, the live count (large, bold), and a grey `−` (or a
 * red trash when one more tap removes the line). The buttons are bare rounded
 * squares — NOT wrapped in a bordered pill — so on a product card they read as
 * the reference does: `+` hugging the top-right corner, the count centred, `−`
 * at the bottom-right (`spanHeight`). Dark glyphs on a light fill keep the
 * decrement clearly visible; each button clears a 52pt hit target via `hitSlop`.
 */
export function QtyStepper({
  quantity,
  onIncrement,
  onDecrement,
  decrementIcon,
  increaseLabel,
  decreaseLabel,
  spanHeight = false,
  decrementDisabled = false,
}: QtyStepperProps): React.JSX.Element {
  const isTrash = decrementIcon === 'trash' && !decrementDisabled;

  return (
    <View style={[styles.container, spanHeight ? styles.span : styles.stack]}>
      <Pressable
        style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        onPress={onIncrement}
        hitSlop={HIT}
        accessibilityRole="button"
        accessibilityLabel={increaseLabel}
      >
        <Ionicons name="add" size={19} color={colors.textPrimary} />
      </Pressable>
      <Text style={styles.qty}>{quantity}</Text>
      <Pressable
        style={({ pressed }) => [
          styles.btn,
          pressed && !decrementDisabled && styles.btnPressed,
          decrementDisabled && styles.btnDisabled,
        ]}
        // ⚠️ `disabled` KULLANMA (S104 canlı bulgu): devre dışı bir Pressable
        // dokunuşu TÜKETMEZ → dokunuş alttaki ürün-kartı Pressable'ına düşer ve
        // `onAdd` çalışır; pasif "−" sessizce ÜRÜN EKLER. Bunun yerine buton
        // etkin kalır, `onPress` no-op olur: dokunuşu yutar, hiçbir şey yapmaz.
        onPress={decrementDisabled ? noop : onDecrement}
        hitSlop={HIT}
        accessibilityRole="button"
        accessibilityState={{ disabled: decrementDisabled }}
        accessibilityLabel={decreaseLabel}
      >
        <Ionicons
          name={isTrash ? 'trash-outline' : 'remove'}
          size={isTrash ? 18 : 19}
          color={
            decrementDisabled
              ? colors.textSecondary
              : isTrash
                ? colors.danger
                : colors.textPrimary
          }
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  span: {
    flex: 1,
    justifyContent: 'space-between',
  },
  stack: {
    gap: 6,
  },
  btn: {
    width: SEG,
    height: SEG,
    borderRadius: radius.md,
    backgroundColor: colors.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: {
    backgroundColor: colors.border,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  qty: {
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
    paddingVertical: 2,
  },
});
