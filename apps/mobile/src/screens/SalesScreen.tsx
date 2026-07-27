import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { formatMoney } from '@restoran-pos/shared-domain';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOpenOrdersTotal, useRevenueForDate } from '../features/sales/queries';
import { colors, minTouchTarget, radius, spacing, typography } from '../theme';

/**
 * Yerel takvim gününü `YYYY-MM-DD`'ye çevirir.
 *
 * `toISOString()` KULLANILMAZ — o UTC'ye kaydırır ve Türkiye saatiyle akşam
 * girilen bir gün "yarın" olarak gider. Sunucu pencereyi zaten tenant
 * timezone'unda keser (ADR-026 Amd5 K5); istemcinin tek işi doğru takvim
 * gününü yazmaktır.
 */
function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Bugüne göre `offset` gün kaydırılmış yerel gün (offset <= 0). */
function dayFromOffset(offset: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
}

/**
 * Gün etiketi: `26.07.2026`.
 *
 * Ay adı için `Intl` KULLANILMAZ: cihazda locale verisi eksikse İngilizce ay
 * adına düşerdi ("kullanıcıya Türkçe olmayan metin gösterme" kuralı). Sayısal
 * biçim her cihazda aynı ve Türkiye'de standart okunuştur.
 */
function formatDateLabel(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

/**
 * Satış ekranı (ADR-026 Amendment 5 K5).
 *
 * Tek büyük sayı = **Toplam Ciro**; altında iki küçük kırılım satırı (tahsil
 * edilen / açık adisyonlar) rakamın ne olduğunu yanıltmadan söyler.
 *
 *   Ciro(D) = A(D) + B(D)
 *   A(D) = tahsil edilen (paid siparişler, pencere sunucuda tenant TZ'sinde)
 *   B(D) = açık adisyonların KALANI — yalnız D = bugün iken; geçmiş günde
 *          "şu an açık" kavramı yoktur, satır gizlenir ve istek atılmaz.
 *
 * Tarih seçici saf JS'tir (native datepicker OTA ile inemez — K8/Alternatif J):
 * `‹ gün ›` gezgini + "Bugün" kısayolu; ileri ok bugünden sonrasına kapalıdır.
 * Tüm tutarlar integer kuruştur (float yok), biçimlendirme `formatMoney`.
 *
 * Ekran YALNIZ admin/cashier oturumunda sekme olarak kayıtlıdır (K1); rol
 * kontrolü sekme seviyesinde tek yerde yapılır, burada tekrarlanmaz.
 */
export function SalesScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [dayOffset, setDayOffset] = useState(0);
  const isToday = dayOffset === 0;
  const selectedDate = useMemo(() => dayFromOffset(dayOffset), [dayOffset]);
  const dateKey = toDateKey(selectedDate);

  const revenueQuery = useRevenueForDate(dateKey);
  const openQuery = useOpenOrdersTotal(isToday);

  // Sekmeye her dönüşte rakam tazelenir: bayat ciro yanıltıcıdır. Yalnız AKTİF
  // (mount'lu) query'ler yeniden çekilir; gezginle ziyaret edilmiş eski günler
  // sadece "stale" işaretlenir.
  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    }, [queryClient]),
  );

  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const handleRefresh = async (): Promise<void> => {
    setIsPullRefreshing(true);
    try {
      await Promise.all([
        revenueQuery.refetch(),
        ...(isToday ? [openQuery.refetch()] : []),
      ]);
    } finally {
      setIsPullRefreshing(false);
    }
  };

  const collectedCents = revenueQuery.data?.totalRevenueCents ?? null;
  // Geçmiş günde açık adisyon kavramı yok → B = 0 (K5).
  const openCents = isToday ? (openQuery.data?.openTotalCents ?? null) : 0;
  const totalCents =
    collectedCents === null || openCents === null
      ? null
      : collectedCents + openCents;

  const isLoading = revenueQuery.isPending || (isToday && openQuery.isPending);
  // Yalnız İLK yükleme hatası tam-ekran hataya düşer (TablesScreen deseni):
  // arka-plan refetch hatası cache'li rakamı silmez.
  const isError =
    revenueQuery.isLoadingError || (isToday && openQuery.isLoadingError);

  const money = (cents: number | null): string =>
    cents === null ? '—' : formatMoney(cents);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('sales.title')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={isPullRefreshing}
            onRefresh={() => {
              void handleRefresh();
            }}
            tintColor={colors.slate}
          />
        }
      >
        <View style={styles.dateBar}>
          <Pressable
            style={styles.arrowButton}
            onPress={() => setDayOffset((offset) => offset - 1)}
            accessibilityRole="button"
            accessibilityLabel={t('sales.prevDay')}
          >
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>

          <View style={styles.dateCenter}>
            <Text style={styles.dateText}>{formatDateLabel(selectedDate)}</Text>
            {isToday ? (
              <Text style={styles.dateHint}>{t('sales.today')}</Text>
            ) : (
              <Pressable
                style={styles.todayButton}
                onPress={() => setDayOffset(0)}
                accessibilityRole="button"
                accessibilityLabel={t('sales.today')}
              >
                <Text style={styles.todayButtonText}>{t('sales.today')}</Text>
              </Pressable>
            )}
          </View>

          {/* Gelecek tarih sorgulanmaz — ileri ok bugünde devre dışı (K5). */}
          <Pressable
            style={[styles.arrowButton, isToday && styles.arrowButtonDisabled]}
            onPress={() => setDayOffset((offset) => Math.min(0, offset + 1))}
            disabled={isToday}
            accessibilityRole="button"
            accessibilityState={{ disabled: isToday }}
            accessibilityLabel={t('sales.nextDay')}
          >
            <Ionicons
              name="chevron-forward"
              size={24}
              color={isToday ? colors.border : colors.textPrimary}
            />
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.slate} />
            <Text style={styles.hintText}>{t('sales.loading')}</Text>
          </View>
        ) : isError ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{t('sales.error')}</Text>
            <Pressable
              style={styles.retryButton}
              onPress={() => {
                void handleRefresh();
              }}
              accessibilityRole="button"
              accessibilityLabel={t('common.retry')}
            >
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.totalLabel}>{t('sales.totalRevenue')}</Text>
            <Text style={styles.totalValue} numberOfLines={1} adjustsFontSizeToFit>
              {money(totalCents)}
            </Text>
            {/* Sıfır bir hata değil, bir bilgidir — rakamı yalnız başına
                bırakmak "yüklenemedi mi?" sorusunu doğuruyordu. */}
            {totalCents === 0 ? (
              <Text style={styles.emptyHint}>{t('sales.empty')}</Text>
            ) : null}

            <View style={styles.divider} />

            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>{t('sales.collected')}</Text>
              <Text style={styles.breakdownValue}>{money(collectedCents)}</Text>
            </View>

            {/* Geçmiş gün seçiliyken satır GİZLENİR (K5) — "şu an açık"
                bilgisi geçmiş bir gün için yanıltıcı olurdu. */}
            {isToday ? (
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>{t('sales.openTabs')}</Text>
                <Text style={styles.breakdownValue}>{money(openCents)}</Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    backgroundColor: colors.slate,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  headerTitle: {
    color: colors.slateText,
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
  },
  body: {
    padding: spacing.md,
    gap: spacing.md,
  },
  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
  },
  arrowButton: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowButtonDisabled: {
    opacity: 0.4,
  },
  dateCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  dateText: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  dateHint: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
  },
  todayButton: {
    minHeight: minTouchTarget - spacing.lg,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
  },
  todayButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
    color: colors.accent,
  },
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  totalLabel: {
    fontSize: typography.fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  totalValue: {
    fontSize: typography.fontSize.xxl,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  emptyHint: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  breakdownLabel: {
    fontSize: typography.fontSize.md,
    color: colors.textSecondary,
  },
  breakdownValue: {
    fontSize: typography.fontSize.md,
    fontWeight: '700',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  hintText: {
    fontSize: typography.fontSize.md,
    color: colors.textSecondary,
  },
  errorText: {
    fontSize: typography.fontSize.md,
    color: colors.danger,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.slate,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    color: colors.slateText,
    fontSize: typography.fontSize.md,
    fontWeight: '700',
  },
});
