import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, Save } from 'lucide-react';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import { useTables, useAreas } from '../tables/api';
import type { ApiProduct } from '../admin/menu-products/api';
import { OrderScreenHeader } from './components/OrderScreenHeader';
import { AdisyonPanel } from './components/AdisyonPanel';
import { ProductCatalog } from './components/ProductCatalog';
import { useCart } from './useCart';
import {
  useAddOrderItems,
  useCreateOrder,
  useOpenOrderForTable,
  useOrderById,
} from './api';

/**
 * Masa Detay / Sipariş Alma — ADR-013 (Phase 2).
 *
 * 3-pane layout (ADR-013 §4):
 *   - Üst: OrderScreenHeader (sol sütun)
 *   - Orta sol: ProductCatalog (PR-2)
 *   - Sağ: AdisyonPanel (PR-3 pending + PR-4 persisted + Kaydet butonu)
 *
 * PR-4 (Kaydet) akışı (ADR-013 §1+§2):
 *   1. useOpenOrderForTable: masada açık sipariş var mı (status='open')
 *   2. Pending varsa Kaydet butonu görünür
 *   3. Save akışı:
 *      - Açık sipariş varsa → POST /orders/:id/items (mevcut siparişe ekle)
 *      - Yoksa → POST /orders (yeni sipariş + items atomik)
 *   4. Snapshot server-side (productName, unitPriceCents, categoryNameSnapshot,
 *      createdByName) — UI değerleri yok sayılır.
 *   5. Success → cart.clear() + react-query invalidate (persisted listesi yenilenir).
 */
export default function OrderScreenPage() {
  const { tableId } = useParams<{ tableId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const tablesQuery = useTables();
  const areasQuery = useAreas();

  const table = useMemo(
    () => tablesQuery.data?.find((tbl) => tbl.id === tableId) ?? null,
    [tablesQuery.data, tableId],
  );

  const areaName = useMemo(() => {
    if (!table?.area_id) return null;
    return areasQuery.data?.find((a) => a.id === table.area_id)?.name ?? null;
  }, [areasQuery.data, table?.area_id]);

  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);

  const cart = useCart();

  // Açık sipariş lookup (masa için tek 'open' status'lu sipariş).
  const openOrderQuery = useOpenOrderForTable(tableId ?? null);
  const persistedOrderId = openOrderQuery.data?.id ?? null;
  const persistedQuery = useOrderById(persistedOrderId);
  const persistedItems = persistedQuery.data?.items ?? [];
  const persistedSubtotalCents = persistedItems.reduce(
    (sum, it) => sum + it.total_cents,
    0,
  );

  const createOrder = useCreateOrder();
  const addItems = useAddOrderItems();
  const isSaving = createOrder.isPending || addItems.isPending;

  // Order kapanırsa cart'ı koru — kullanıcı yine yazmaya devam edebilir.
  // Ama tab değişimi/refresh sonrası cart YOK (saf local state ADR-013 §1).
  const persistedHasError = persistedQuery.isError;
  useEffect(() => {
    if (!persistedHasError) return;
    // Sipariş kapanmış olabilir (404). Cache invalidate ile yeniden yükle.
    void openOrderQuery.refetch();
  }, [persistedHasError, openOrderQuery]);

  const handleBack = () => navigate('/tables');
  // Placeholder handlers — sonraki PR'larda gerçek davranış (PR-7/8/9/10).
  const handleCustomer = () => undefined;
  const handlePrint = () => undefined;
  const handleTransferTable = () => undefined;

  const handleSelectProduct = (product: ApiProduct) => cart.addItem(product);
  const handleDecrementProduct = (product: ApiProduct) =>
    cart.decrementItem(product.id);

  const extractError = (err: unknown, fallback: string): string => {
    if (isAxiosError(err)) {
      const data = err.response?.data as
        | { error?: { code?: string; message?: string } }
        | undefined;
      const code = data?.error?.code;
      if (code) {
        const localized = t(`order.errors.${code}`, { defaultValue: '' });
        if (localized) return localized;
      }
      return data?.error?.message ?? fallback;
    }
    return fallback;
  };

  const handleSave = async () => {
    if (!cart.isDirty || isSaving || !table) return;

    // Snapshot UI'da hesaplanmaz; server productId + quantity'den çözecek.
    // Note PR-6 attribute modal sonrası gelir; PR-4'te boş.
    const items = cart.items.map((it) => ({
      productId: it.productId,
      quantity: it.quantity,
    }));

    try {
      if (persistedOrderId !== null) {
        await addItems.mutateAsync({ orderId: persistedOrderId, items });
      } else {
        await createOrder.mutateAsync({
          tableId: table.id,
          orderType: 'dine_in',
          items,
        });
      }
      toast.success(t('order.adisyon.saveSuccess'));
      cart.clear();
    } catch (err) {
      toast.error(extractError(err, t('order.adisyon.saveError')));
    }
  };

  if (tablesQuery.isPending || areasQuery.isPending) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2
          className="h-8 w-8 animate-spin"
          style={{ color: 'var(--v3-text-muted)' }}
        />
      </div>
    );
  }

  if (!table) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p
          className="text-base font-medium"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {t('order.errors.tableNotFound')}
        </p>
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex h-10 items-center rounded-lg border bg-white px-4 text-[13px] font-semibold transition-colors hover:bg-accent"
          style={{ borderColor: 'var(--v3-border-subtle)' }}
        >
          {t('order.errors.backToTables')}
        </button>
      </div>
    );
  }

  const persistedItemCount = persistedItems.filter(
    (it) => !it.is_comped, // PR-7 ödeme'de farklı; pendingItemCount header için sadeleştirme
  ).length;
  const subtotalCents = cart.subtotalCents + persistedSubtotalCents;
  const totalCents = subtotalCents;
  const hint = cart.isDirty ? t('order.adisyon.saveHint') : null;

  // Kaydet butonu — yalnız pending varken görünür (PR-7 Ödeme/Hızlı Öde butonları
  // persisted-only durumda gelecek; v3 paritesi).
  const saveButton = cart.isDirty ? (
    <button
      type="button"
      onClick={handleSave}
      disabled={isSaving}
      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg text-[14px] font-bold text-white shadow-sm transition-all duration-[120ms] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 disabled:cursor-not-allowed disabled:opacity-60"
      style={{ background: 'var(--v3-purple, #7c3aed)' }}
    >
      {isSaving ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <Save className="h-5 w-5" />
      )}
      {t('order.adisyon.save')}
    </button>
  ) : null;

  return (
    <div
      className="grid h-screen w-full grid-cols-[7fr_3fr] bg-stone-50"
      style={{ borderBottom: '3px solid var(--v3-purple, #7c3aed)' }}
    >
      {/* Sol sütun: header + catalog */}
      <div className="grid min-h-0 grid-rows-[auto_1fr] overflow-hidden">
        <OrderScreenHeader
          tableCode={table.code}
          areaName={areaName}
          hasPersistedOrder={persistedItemCount > 0}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          onBack={handleBack}
          onCustomer={handleCustomer}
          onPrint={handlePrint}
        />

        <ProductCatalog
          searchTerm={searchTerm}
          activeCategoryId={activeCategoryId}
          onChangeCategory={setActiveCategoryId}
          onSelectProduct={handleSelectProduct}
          onDecrementProduct={handleDecrementProduct}
          pendingQtyByProductId={cart.pendingQtyByProductId}
        />
      </div>

      {/* Sağ sütun: AdisyonPanel — pending + Kaydet butonu */}
      <AdisyonPanel
        persistedItemCount={persistedItemCount}
        pendingItems={cart.items}
        subtotalCents={subtotalCents}
        totalCents={totalCents}
        hint={hint}
        actionsSlot={saveButton}
        onPendingIncrement={cart.incrementItem}
        onPendingDecrement={cart.decrementItem}
        onPendingRemove={cart.removeItem}
        onTransferTable={handleTransferTable}
        onClose={handleBack}
      />
    </div>
  );
}
