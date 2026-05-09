import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ChefHat, RefreshCw } from 'lucide-react';
import { AppShell } from '../../components/layout/AppShell';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Button } from '../../components/ui/button';
import { KdsOrderCard } from './KdsOrderCard';
import { useKdsOrders, useUpdateItemStatus } from './api';
import { useKitchenRealtime } from './useKitchenRealtime';

/**
 * KDS sayfası — Sprint 12 PR-3 (ADR-020 K2/K3/K4/K6/K7).
 *
 * - Full-screen grid; FIFO sıralama backend'den (`created_at ASC`).
 * - `useKitchenRealtime` socket event'leri React Query cache'i invalidate eder.
 * - PATCH başarısız olursa sonner toast + "Tekrar dene" action.
 * - Per-item pendingItemIds Set: sadece tıklanan item disable, diğer butonlar
 *   aktif kalır (HCI feedback: global isPending tüm KDS'i kilitliyordu).
 */
export default function KdsPage() {
  const { t } = useTranslation();
  const {
    data: orders,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useKdsOrders();
  const updateStatus = useUpdateItemStatus();
  const [pendingItemIds, setPendingItemIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  useKitchenRealtime();

  const handleStatusChange = (
    orderId: string,
    itemId: string,
    next: 'preparing' | 'ready',
  ): void => {
    setPendingItemIds((prev) => {
      const updated = new Set(prev);
      updated.add(itemId);
      return updated;
    });
    updateStatus.mutate(
      { orderId, itemId, status: next },
      {
        onSettled: () => {
          setPendingItemIds((prev) => {
            const updated = new Set(prev);
            updated.delete(itemId);
            return updated;
          });
        },
        onError: () => {
          toast.error(t('kds.error.updateFailed'), {
            action: {
              label: t('kds.action.retry'),
              onClick: () => handleStatusChange(orderId, itemId, next),
            },
          });
        },
      },
    );
  };

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border bg-white px-6 py-4 pl-16">
          <div className="flex items-center gap-3">
            <ChefHat className="h-6 w-6 text-orange-600" />
            <h1 className="text-xl font-bold tracking-tight">
              {t('kds.title')}
            </h1>
          </div>
          {orders !== undefined && orders.length > 0 && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {t('kds.orderCount', { count: orders.length })}
            </span>
          )}
        </header>

        {/* Body */}
        <div className="flex-1 overflow-auto bg-stone-50 p-4">
          {isLoading ? (
            <LoadingSkeleton />
          ) : isError ? (
            <ErrorState
              onRetry={() => void refetch()}
              isRetrying={isRefetching}
            />
          ) : orders === undefined || orders.length === 0 ? (
            <EmptyState />
          ) : (
            <div
              className="grid gap-4"
              style={{
                gridTemplateColumns:
                  'repeat(auto-fill, minmax(320px, 1fr))',
              }}
            >
              {orders.map((order) => (
                <KdsOrderCard
                  key={order.id}
                  order={order}
                  onItemStatusChange={handleStatusChange}
                  pendingItemIds={pendingItemIds}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <ChefHat className="h-16 w-16 text-stone-300" />
      <div className="text-lg font-semibold text-foreground">
        {t('kds.empty.title')}
      </div>
      <div className="max-w-sm text-sm text-muted-foreground">
        {t('kds.empty.body')}
      </div>
    </div>
  );
}

function ErrorState({
  onRetry,
  isRetrying,
}: {
  onRetry: () => void;
  isRetrying: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="text-base font-semibold text-[var(--danger)]">
        {t('kds.error.loadFailed')}
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={onRetry}
        disabled={isRetrying}
        className="h-12 gap-2"
      >
        <RefreshCw
          className={`h-4 w-4 ${isRetrying ? 'animate-spin' : ''}`}
        />
        {t('kds.action.retry')}
      </Button>
    </div>
  );
}
