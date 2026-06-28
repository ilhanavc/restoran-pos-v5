import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from '@restoran-pos/shared-domain';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, minTouchTarget, radius, spacing } from '../../theme';
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
 * Single square table card (ADR-026 K2/K3).
 *
 * Two modes:
 *   - empty (available): white card, "Masa N" + a green status dot.
 *   - occupied: amber tint, "Masa N" + ₺total (bold) + a live elapsed timer
 *     (Clock + "X dk Y sn", ticking once a second from `active_order_started_at`).
 *     An order open >= 60 min turns the card red (long-open warning).
 *
 * The waiter name is shown only when the open duration leaves room (K2: total +
 * timer take priority on a narrow square). Empty and occupied cards share the
 * same tap target (web `/tables/:id/order` parity). No payment / actions / void
 * affordances are rendered — those are gated out for the waiter (K6) and the
 * order flow lands in PR-5c.
 */
export function TableCard({
  table,
  displayName,
  onPress,
}: TableCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const isOccupied =
    table.status === 'occupied' && table.active_order_started_at !== null;

  // One-second tick for the open-duration label. Empty tables do not tick.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isOccupied) {
      return;
    }
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [isOccupied]);

  const elapsedMs =
    isOccupied && table.active_order_started_at !== null
      ? now - new Date(table.active_order_started_at).getTime()
      : null;
  const isLongOpen = elapsedMs !== null && elapsedMs > LONG_OPEN_MS;

  const cardStateStyle = isLongOpen
    ? styles.cardLongOpen
    : isOccupied
      ? styles.cardOccupied
      : styles.cardAvailable;

  const accessibilityLabel = `${displayName} — ${t(
    `tables.status.${table.status}`,
  )}`;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        cardStateStyle,
        pressed && styles.cardPressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.headerRow}>
        <Text style={styles.tableName} numberOfLines={1}>
          {displayName}
        </Text>
        {!isOccupied ? (
          <View style={[styles.dot, styles.dotAvailable]} />
        ) : (
          <View
            style={[
              styles.dot,
              isLongOpen ? styles.dotLongOpen : styles.dotOccupied,
            ]}
          />
        )}
      </View>

      {!isOccupied ? (
        <View style={styles.emptyBody}>
          <Ionicons name="add" size={28} color={colors.border} />
        </View>
      ) : (
        <View style={styles.occupiedBody}>
          {table.active_order_total_cents !== null ? (
            <Text style={styles.total} numberOfLines={1}>
              {formatMoney(table.active_order_total_cents)}
            </Text>
          ) : null}
          {elapsedMs !== null ? (
            <View style={styles.timerRow}>
              <Ionicons
                name="time-outline"
                size={12}
                color={isLongOpen ? colors.longOpenText : colors.occupiedText}
              />
              <Text
                style={[
                  styles.timer,
                  isLongOpen ? styles.timerLongOpen : styles.timerOccupied,
                ]}
                numberOfLines={1}
              >
                {formatElapsed(elapsedMs)}
              </Text>
            </View>
          ) : null}
          {table.active_waiter_name !== null ? (
            <Text style={styles.waiter} numberOfLines={1}>
              {table.active_waiter_name}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    aspectRatio: 1,
    minHeight: minTouchTarget,
    borderRadius: radius.md,
    borderWidth: 1.5,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  cardPressed: {
    opacity: 0.85,
  },
  cardAvailable: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  cardOccupied: {
    backgroundColor: colors.occupiedBg,
    borderColor: colors.occupiedText,
  },
  cardLongOpen: {
    backgroundColor: colors.longOpenBg,
    borderColor: colors.longOpenText,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  tableName: {
    flexShrink: 1,
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginTop: 4,
  },
  dotAvailable: {
    backgroundColor: colors.available,
  },
  dotOccupied: {
    backgroundColor: colors.occupiedText,
  },
  dotLongOpen: {
    backgroundColor: colors.longOpenText,
  },
  emptyBody: {
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
  },
  occupiedBody: {
    gap: 2,
  },
  total: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  timer: {
    fontSize: 11,
    fontWeight: '600',
  },
  timerOccupied: {
    color: colors.occupiedText,
  },
  timerLongOpen: {
    color: colors.longOpenText,
  },
  waiter: {
    fontSize: 11,
    color: colors.textSecondary,
  },
});
