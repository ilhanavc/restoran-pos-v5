import { formatMoney } from '@restoran-pos/shared-domain';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../../theme';
import type { ApiTable } from '../../api/tables';
import { formatElapsed, LONG_OPEN_MS } from './elapsed';

interface TableCardProps {
  table: ApiTable;
  /** Region-local ordinal label ("Masa 1", "Masa 2"...) computed by the grid. */
  displayName: string;
  /** Open the order screen for this table (empty = new bill, occupied = open). */
  onPress: () => void;
}

/**
 * Single table card (ADR-026 K2/K3, reference-parity revamp).
 *
 * A roomy portrait card with a soft shadow:
 *   - empty (available): white card, "Masa N" centred in muted grey.
 *   - occupied: tinted card with "Masa N" (top), the open-bill ₺total (centre,
 *     bold) and the live elapsed time ("37 dk", bottom). A bill open >= 60 min
 *     turns the card red (long-open warning); under that it is amber.
 *
 * No payment / 3-dot / Caller-ID / "+ new" affordances are rendered — those are
 * gated out for the waiter (K6). Empty and occupied cards share the same tap
 * target (web `/tables/:id/order` parity).
 */
export function TableCard({
  table,
  displayName,
  onPress,
}: TableCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const elapsedLabels = {
    day: t('tables.elapsed.day'),
    hour: t('tables.elapsed.hour'),
    minute: t('tables.elapsed.minute'),
  };
  const isOccupied =
    table.status === 'occupied' && table.active_order_started_at !== null;

  // One-minute tick for the open-duration label. Empty tables do not tick.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isOccupied) {
      return;
    }
    const id = setInterval(() => {
      setNow(Date.now());
    }, 30000);
    return () => {
      clearInterval(id);
    };
  }, [isOccupied]);

  const elapsedMs =
    isOccupied && table.active_order_started_at !== null
      ? now - new Date(table.active_order_started_at).getTime()
      : null;
  const isLongOpen = elapsedMs !== null && elapsedMs > LONG_OPEN_MS;

  const accessibilityLabel = `${displayName} — ${t(
    `tables.status.${table.status}`,
  )}`;

  if (!isOccupied) {
    return (
      <Pressable
        style={({ pressed }) => [
          styles.card,
          styles.cardAvailable,
          pressed && styles.cardPressed,
        ]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <Text style={styles.emptyName} numberOfLines={1}>
          {displayName}
        </Text>
      </Pressable>
    );
  }

  const accent = isLongOpen ? colors.longOpenText : colors.occupiedText;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        isLongOpen ? styles.cardLongOpen : styles.cardOccupied,
        pressed && styles.cardPressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={[styles.occupiedName, { color: accent }]} numberOfLines={1}>
        {displayName}
      </Text>
      <Text style={[styles.total, { color: accent }]} numberOfLines={1}>
        {table.active_order_total_cents !== null
          ? formatMoney(table.active_order_total_cents)
          : '—'}
      </Text>
      {elapsedMs !== null ? (
        <Text style={[styles.elapsed, { color: accent }]} numberOfLines={1}>
          {formatElapsed(elapsedMs, elapsedLabels)}
        </Text>
      ) : (
        <View />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    aspectRatio: 0.86,
    minHeight: 80,
    borderRadius: radius.lg,
    padding: spacing.sm,
    justifyContent: 'space-between',
    // Soft elevation (reference parity) — replaces the hard border.
    backgroundColor: colors.background,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  cardPressed: {
    opacity: 0.85,
  },
  cardAvailable: {
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardOccupied: {
    backgroundColor: colors.occupiedBg,
  },
  cardLongOpen: {
    backgroundColor: colors.longOpenBg,
  },
  emptyName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  occupiedName: {
    fontSize: 16,
    fontWeight: '700',
  },
  total: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  elapsed: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
