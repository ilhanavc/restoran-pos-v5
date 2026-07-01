import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '../theme';

interface ToastProps {
  /** Message to show; `null` hides the toast. */
  message: string | null;
  onDismiss: () => void;
  tone?: 'success' | 'error';
  durationMs?: number;
}

/**
 * Minimal non-blocking snackbar (HCI: rush-hour feedback without a modal gate).
 *
 * Auto-dismisses after `durationMs`. Used to confirm money/print actions whose
 * result the board doesn't make obvious on its own (a print enqueue) or to add a
 * light confirmation to a quick payment. `pointerEvents="none"` so it never
 * blocks a tap underneath. Bottom-anchored, above the gesture inset.
 */
export function Toast({
  message,
  onDismiss,
  tone = 'success',
  durationMs = 2600,
}: ToastProps): React.JSX.Element | null {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (message === null) {
      return;
    }
    const id = setTimeout(() => {
      onDismissRef.current();
    }, durationMs);
    return () => {
      clearTimeout(id);
    };
  }, [message, durationMs]);

  if (message === null) {
    return null;
  }

  return (
    <SafeAreaView style={styles.wrap} edges={['bottom']} pointerEvents="none">
      <View
        style={[styles.toast, tone === 'error' ? styles.error : styles.success]}
      >
        <Text style={styles.text} numberOfLines={2}>
          {message}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  toast: {
    maxWidth: '100%',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  success: {
    backgroundColor: colors.slate,
  },
  error: {
    backgroundColor: colors.danger,
  },
  text: {
    color: colors.slateText,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
});
