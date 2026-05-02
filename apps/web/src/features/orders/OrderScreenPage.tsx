import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CreditCard, Loader2, Save, Zap } from 'lucide-react';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useTables, useAreas } from '../tables/api';
import { useProductsAdmin, type ApiProduct } from '../admin/menu-products/api';
import { OrderScreenHeader } from './components/OrderScreenHeader';
import { AdisyonPanel } from './components/AdisyonPanel';
import { ProductCatalog } from './components/ProductCatalog';
import { VoidItemConfirmDialog } from './components/VoidItemConfirmDialog';
import { OrderProductDetailModal } from './components/OrderProductDetailModal';
import { useCart, type CartItem } from './useCart';
import {
  useAddOrderItems,
  useCreateOrder,
  useOrderById,
  useUpdateOrderItem,
  type ApiOrderItem,
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

  const queryClient = useQueryClient();
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

  // Açık sipariş id'si — useTables baseQuery active_order_id projection'undan
  // gelir (storeDate filter'ı YOK; eski tarihli aktif sipariş de görünür).
  // Race koruma için handleSave öncesi tablesQuery.refetch() yapılır.
  const persistedOrderId = table?.active_order_id ?? null;
  const persistedQuery = useOrderById(persistedOrderId);
  const persistedItems = persistedQuery.data?.items ?? [];
  // Server otorite (ADR-013 §2 + Migration 020 recalc): orders.total_cents zaten
  // cancelled + is_comped satırlarını dışlıyor. UI sadece okur.
  const persistedSubtotalCents = persistedQuery.data?.order.total_cents ?? 0;

  const createOrder = useCreateOrder();
  const addItems = useAddOrderItems();
  const updateItem = useUpdateOrderItem();
  const isSaving = createOrder.isPending || addItems.isPending;

  const [voidTarget, setVoidTarget] = useState<ApiOrderItem | null>(null);
  /** PR-6 (ADR-013 §10 Karar 10.2): ürün detay modal — yeni ekleme veya
   *  pending satır düzenleme. `editingRowId` null ise yeni ekleme; doluysa
   *  o rowId'li pending satırı editle. */
  const [modalProduct, setModalProduct] = useState<ApiProduct | null>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const editingItem = useMemo<CartItem | null>(
    () =>
      editingRowId === null
        ? null
        : cart.items.find((it) => it.rowId === editingRowId) ?? null,
    [cart.items, editingRowId],
  );

  // Order kapanırsa cart'ı koru — kullanıcı yine yazmaya devam edebilir.
  // Ama tab değişimi/refresh sonrası cart YOK (saf local state ADR-013 §1).
  const persistedHasError = persistedQuery.isError;
  useEffect(() => {
    if (!persistedHasError) return;
    // Sipariş kapanmış olabilir (404). Tables query'yi refetch — fresh
    // active_order_id (null'a düşmüş olabilir) için.
    void tablesQuery.refetch();
  }, [persistedHasError, tablesQuery]);

  const handleBack = () => navigate('/tables');
  // Placeholder handlers — sonraki PR'larda gerçek davranış (PR-7/8/9/10).
  const handleCustomer = () => undefined;
  const handlePrint = () => undefined;
  const handleTransferTable = () => undefined;

  // ADR-013 §10 Karar 10.1: ürün kartı tıklama → modal yok, doğrudan quickAdd
  // (default variant ile, varsa).
  const handleSelectProduct = (product: ApiProduct) => cart.addItem(product);
  // PR-3 stepper "−" overlay → quickAdd ile EKLENMİŞ satırın decrement'i.
  // ADR-013 §11: composite key 5-tuple (productId|variantId|attrHash|note);
  // baseline = default variant + boş özellik + boş not.
  const handleDecrementProduct = (product: ApiProduct) => {
    const defaultVariant =
      product.variants.find((v) => v.isDefault) ?? product.variants[0] ?? null;
    const variantPart = defaultVariant?.id ?? '';
    const baselineRowId = `${product.id}|${variantPart}|[]|`;
    cart.decrementItem(baselineRowId);
  };

  // ADR-013 §10 Karar 10.2 + §11: pending satır tıklama → modal düzenleme.
  // Modal porsiyon picker için product.variants ve özellik gruplari için id'yi
  // kullanır; bu yüzden tam ApiProduct şekli (variants[]) gerek. Cart cevabı
  // taşımıyor, useProductsAdmin cache'inden çek.
  const productsListQuery = useProductsAdmin();
  const productsById = useMemo(() => {
    const m = new Map<string, ApiProduct>();
    for (const p of productsListQuery.data ?? []) m.set(p.id, p);
    return m;
  }, [productsListQuery.data]);

  const handlePendingEdit = (item: CartItem) => {
    const fullProduct = productsById.get(item.productId);
    if (fullProduct === undefined) {
      // Fallback — ürün cache'de yoksa minimum şekil; porsiyon picker boş gelir
      // ama not + adet düzenlenebilir.
      setModalProduct({
        id: item.productId,
        name: item.productName,
        priceCents: item.productPriceCents,
        variants: [],
      } as unknown as ApiProduct);
    } else {
      setModalProduct(fullProduct);
    }
    setEditingRowId(item.rowId);
  };

  const handleModalConfirm = (payload: import('./useCart').CartItemEditPayload) => {
    if (modalProduct === null) return;
    if (editingRowId !== null) {
      cart.editItem(editingRowId, modalProduct, payload);
    } else {
      cart.addItemDetailed(modalProduct, payload);
    }
    setModalProduct(null);
    setEditingRowId(null);
  };

  const handleModalClose = () => {
    setModalProduct(null);
    setEditingRowId(null);
  };

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

  const handleVoidConfirm = async () => {
    if (voidTarget === null || persistedOrderId === null) return;
    try {
      await updateItem.mutateAsync({
        orderId: persistedOrderId,
        itemId: voidTarget.id,
        patch: { status: 'cancelled' },
      });
      toast.success(t('order.adisyon.voidSuccess'));
      setVoidTarget(null);
    } catch (err) {
      toast.error(extractError(err, t('order.adisyon.voidError')));
    }
  };

  const handleSave = async () => {
    if (!cart.isDirty || isSaving || !table) return;

    // Snapshot UI'da hesaplanmaz; server productId + quantity + selectedAttributes
    // (PR-6 ADR-013 §10) ile resolve eder, fiyat sunucu otoritesi.
    const items = cart.items.map((it) => ({
      productId: it.productId,
      quantity: it.quantity,
      ...(it.note !== null ? { note: it.note } : {}),
      ...(it.variant !== null ? { variantId: it.variant.variantId } : {}),
      ...(it.selectedAttributes.length > 0
        ? {
            selectedAttributes: it.selectedAttributes.map((a) => ({
              groupId: a.groupId,
              optionId: a.optionId,
            })),
          }
        : {}),
    }));

    try {
      // Race koruma: cache'deki active_order_id stale olabilir.
      // Save öncesi tables refetch — fresh aktif sipariş id'si.
      const fresh = await tablesQuery.refetch();
      const freshTable = fresh.data?.find((tbl) => tbl.id === table.id);
      const targetOrderId = freshTable?.active_order_id ?? null;

      if (targetOrderId !== null) {
        await addItems.mutateAsync({ orderId: targetOrderId, items });
      } else {
        await createOrder.mutateAsync({
          tableId: table.id,
          orderType: 'dine_in',
          items,
        });
      }
      toast.success(t('order.adisyon.saveSuccess'));
      cart.clear();
      // Masa listesi taze (status='occupied' + tutar güncellemesi için).
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
      navigate('/tables');
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

  // Persisted aktif kalemler (cancelled hariç) — header rozeti + Print buton koşulu.
  const activePersistedCount = persistedItems.filter(
    (it) => it.status !== 'cancelled',
  ).length;
  const subtotalCents = cart.subtotalCents + persistedSubtotalCents;
  const totalCents = subtotalCents;
  const hint = cart.isDirty ? t('order.adisyon.saveHint') : null;

  // Bottom action butonları — v3 ekran 5 paritesi state machine:
  //   pending varsa → mor Kaydet (full-width)
  //   !pending && persisted → Ödeme (mor outline) + Hızlı Öde (yeşil) yan yana
  //   empty → null
  const handleOpenPayment = () => {
    toast.info(t('order.adisyon.paymentSoon'));
  };
  const handleQuickPay = () => {
    toast.info(t('order.adisyon.paymentSoon'));
  };

  let actionsSlot: React.ReactNode = null;
  if (cart.isDirty) {
    actionsSlot = (
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
    );
  } else if (activePersistedCount > 0) {
    actionsSlot = (
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={handleOpenPayment}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border-2 text-[14px] font-bold transition-all duration-[120ms] hover:bg-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          style={{
            borderColor: 'var(--v3-purple, #7c3aed)',
            color: 'var(--v3-purple, #7c3aed)',
            background: 'transparent',
          }}
        >
          <CreditCard className="h-5 w-5" />
          {t('order.adisyon.payment')}
        </button>
        <button
          type="button"
          onClick={handleQuickPay}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-lg text-[14px] font-bold text-white shadow-sm transition-all duration-[120ms] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          style={{ background: 'var(--v3-success, #10b981)' }}
        >
          <Zap className="h-5 w-5" />
          {t('order.adisyon.quickPay')}
        </button>
      </div>
    );
  }

  return (
    <div
      className="grid h-screen w-full grid-cols-[7fr_3fr]"
      style={{
        background: 'var(--v3-bg-app, #F4F7FB)',
        borderBottom: '3px solid var(--v3-purple, #7C5CFA)',
      }}
    >
      {/* Sol sütun: header + catalog */}
      <div className="grid min-h-0 grid-rows-[auto_1fr] overflow-hidden">
        <OrderScreenHeader
          tableCode={table.code}
          areaName={areaName}
          hasPersistedOrder={activePersistedCount > 0}
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

      {/* Sağ sütun: AdisyonPanel — persisted + pending + Kaydet butonu */}
      <AdisyonPanel
        persistedItems={persistedItems}
        pendingItems={cart.items}
        subtotalCents={subtotalCents}
        totalCents={totalCents}
        hint={hint}
        actionsSlot={actionsSlot}
        onPendingIncrement={cart.incrementItem}
        onPendingDecrement={cart.decrementItem}
        onPendingRemove={cart.removeItem}
        onPendingEdit={handlePendingEdit}
        onPersistedVoid={setVoidTarget}
        onTransferTable={handleTransferTable}
        onClose={handleBack}
      />

      <VoidItemConfirmDialog
        target={voidTarget}
        onOpenChange={(v) => !v && setVoidTarget(null)}
        onConfirm={handleVoidConfirm}
        isVoiding={updateItem.isPending}
      />

      <OrderProductDetailModal
        product={modalProduct}
        initial={
          editingItem === null
            ? null
            : {
                selectedAttributes: editingItem.selectedAttributes,
                variant: editingItem.variant,
                note: editingItem.note,
                quantity: editingItem.quantity,
              }
        }
        onClose={handleModalClose}
        onConfirm={handleModalConfirm}
      />
    </div>
  );
}
