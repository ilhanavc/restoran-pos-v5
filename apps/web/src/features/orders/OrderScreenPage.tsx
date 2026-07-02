import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CreditCard, Loader2, Save, Zap } from 'lucide-react';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '../../lib/socket';
import { useTables, useAreas } from '../tables/api';
import { tableDisplayNumber } from '../tables/utils/tableLabel';
import { useCustomer } from '../customers/api/customers';
import { useCategoriesAdmin } from '../admin/menu-categories/api';
import { useProductsAdmin, type ApiProduct } from '../admin/menu-products/api';
import { OrderScreenHeader } from './components/OrderScreenHeader';
import { AdisyonPanel } from './components/AdisyonPanel';
import { ProductCatalog } from './components/ProductCatalog';
import { VoidItemConfirmDialog } from './components/VoidItemConfirmDialog';
import { OrderProductDetailModal } from './components/OrderProductDetailModal';
import {
  CustomerPickerModal,
  type PickedCustomer,
} from './components/CustomerPickerModal';
import { PaymentMethodModal } from './components/PaymentMethodModal';
import { QuickPaymentModal } from '../payment/components/QuickPaymentModal';
import { DetailedPaymentModal } from '../payment/components/DetailedPaymentModal';
import { MoveTableModal } from '../tables/components/MoveTableModal';
import { useOrderCart, type CartItem } from './useOrderCart';
import {
  useAddOrderItems,
  useAssignCustomer,
  useCreateOrder,
  useCreateTakeawayOrder,
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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  // ADR-017 §Frontend: aynı ekran iki modda. tableId varsa dine_in,
  // yoksa search params'tan type=takeaway. Default safety dine_in.
  const orderType: 'dine_in' | 'takeaway' =
    tableId !== undefined
      ? 'dine_in'
      : searchParams.get('type') === 'takeaway'
        ? 'takeaway'
        : 'dine_in';
  const isTakeaway = orderType === 'takeaway';
  // ADR-017 + v3 paritesi (App.jsx:167): paket kartına tıklayınca
  // ?orderId=<uuid> ile mevcut siparişi düzenleme moduna açılır.
  // dine_in modunda göz ardı edilir.
  const takeawayEditOrderId = isTakeaway ? searchParams.get('orderId') : null;
  const isTakeawayEdit = isTakeaway && takeawayEditOrderId !== null;

  const queryClient = useQueryClient();
  const tablesQuery = useTables();
  const areasQuery = useAreas();

  const table = useMemo(
    () =>
      tableId === undefined
        ? null
        : tablesQuery.data?.find((tbl) => tbl.id === tableId) ?? null,
    [tablesQuery.data, tableId],
  );

  const areaName = useMemo(() => {
    if (!table?.area_id) return null;
    return areasQuery.data?.find((a) => a.id === table.area_id)?.name ?? null;
  }, [areasQuery.data, table?.area_id]);

  // ADR-009 Amendment 2026-06-30 Karar A: header + ödeme modali etiketi masa
  // board'u ile birebir aynı = kalıcı per-bölge display_no (i18n key). Bölgesiz
  // orphan → ham code. Pozisyonel ordinal drift'i giderildi.
  const tableLabel = useMemo(() => {
    if (table === null) return '';
    const n = tableDisplayNumber(table);
    return n !== null ? t('tables.tableLabel', { number: n }) : table.code;
  }, [table, t]);

  const [searchTerm, setSearchTerm] = useState('');
  // ADR-013 §10 — kategori sekmeleri. Default davranış: kategoriler
  // yüklendiğinde ilk gerçek kategori (sort_order ASC) seçilir; kullanıcı
  // "Tümü"ye veya başka kategoriye geçtikten sonra otomatik set yapılmaz.
  // (v3 paritesi — OrderScreen ilk kategoriyi pre-selected gösterir.)
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const userPickedCategoryRef = useRef(false);

  const categoriesQuery = useCategoriesAdmin();
  useEffect(() => {
    if (userPickedCategoryRef.current) return;
    if (activeCategoryId !== null) return;
    const categories = categoriesQuery.data;
    if (categories === undefined || categories.length === 0) return;
    const sorted = [...categories].sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'tr'),
    );
    const first = sorted[0];
    if (first === undefined) return;
    setActiveCategoryId(first.id);
  }, [categoriesQuery.data, activeCategoryId]);

  const handleChangeCategory = (categoryId: string | null) => {
    userPickedCategoryRef.current = true;
    setActiveCategoryId(categoryId);
  };

  const cart = useOrderCart();

  // Açık sipariş id'si — useTables baseQuery active_order_id projection'undan
  // gelir (storeDate filter'ı YOK; eski tarihli aktif sipariş de görünür).
  // Race koruma için handleSave öncesi tablesQuery.refetch() yapılır.
  //
  // dine_in: table.active_order_id
  // takeaway "yeni" akış: null (her POST yeni sipariş, ADR-017)
  // takeaway "düzenleme" akış: ?orderId search param (v3 paritesi)
  const persistedOrderId = isTakeaway
    ? takeawayEditOrderId
    : table?.active_order_id ?? null;
  const persistedQuery = useOrderById(persistedOrderId);
  const persistedItems = persistedQuery.data?.items ?? [];
  // Server otorite (ADR-013 §2 + Migration 020 recalc): orders.total_cents zaten
  // cancelled + is_comped satırlarını dışlıyor. UI sadece okur.
  const persistedSubtotalCents = persistedQuery.data?.order.total_cents ?? 0;

  const createOrder = useCreateOrder();
  const createTakeaway = useCreateTakeawayOrder();
  const addItems = useAddOrderItems();
  const updateItem = useUpdateOrderItem();
  const isSaving =
    createOrder.isPending || addItems.isPending || createTakeaway.isPending;

  // Müşteri picker state — v3 paritesi: hem dine_in hem takeaway'de
  // kullanılır. Takeaway için zorunlu (ADR-017), dine_in için opsiyonel
  // (yeni sipariş aşamasında atanabilir; persisted dine_in için PATCH v5.1).
  const [selectedCustomer, setSelectedCustomer] =
    useState<PickedCustomer | null>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [paymentMethodOpen, setPaymentMethodOpen] = useState(false);

  // Persisted dine_in / takeaway-edit modunda müşteri zaten siparişe bağlı;
  // header subtitle için isim çekilir. Müşteri silinmiş ise (customer_id null)
  // header fallback gösterir.
  const persistedCustomerId = persistedQuery.data?.order.customer_id ?? null;
  const persistedCustomerQuery = useCustomer(persistedCustomerId);
  const persistedCustomerName = persistedCustomerQuery.data?.fullName ?? null;

  // Canlı çok-terminal senkron (ADR-010 §11.6): başka bir terminal bu açık
  // siparişi değiştirirse (kalem ekleme/void/comp, ödeme/kapanış, müşteri atama)
  // backend orders.* yayınlar → açık adisyonu (['orders']) + masa tahtasını
  // (['tables']) tazele. invalidate yalnız mount'lu (aktif) query'yi refetch eder.
  useSocketEvent('orders.statusChanged', () => {
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void queryClient.invalidateQueries({ queryKey: ['tables'] });
  });
  useSocketEvent('orders.cancelled', () => {
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void queryClient.invalidateQueries({ queryKey: ['tables'] });
  });
  useSocketEvent('orders.customerAssigned', () => {
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
  });
  // Canlı katalog senkron (ADR-010 §11.6 Amendment 3): başka bir terminalde
  // admin ürün/kategori CRUD yaparsa backend products.changed/categories.changed
  // yayınlar → sipariş ekranının katalog query'lerini tazele (invalidate-only).
  useSocketEvent('products.changed', () => {
    void queryClient.invalidateQueries({ queryKey: ['products'] });
  });
  useSocketEvent('categories.changed', () => {
    void queryClient.invalidateQueries({ queryKey: ['categories'] });
    // Kategori değişimi ürün üyeliğini/sıralamasını etkileyebilir → admin
    // invalidate kontratıyla (useDeleteCategory) simetri için ['products'] da.
    void queryClient.invalidateQueries({ queryKey: ['products'] });
  });

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

  const assignCustomer = useAssignCustomer();

  // ADR-014 §10 Karar 10.1 — "Ödeme" SplitPaymentModal state.
  // ADR-014 §1 + §9 Karar 9.5 — "Hızlı Öde" modal state.
  // NOT: Bu iki useState erken return'lerin (Loader / tableNotFound) ÜSTÜNDE
  // tutulmalı; aksi halde hooks count render'lar arasında değişir ve
  // "Rendered more hooks than during the previous render" hatası fırlar.
  const [splitOpen, setSplitOpen] = useState(false);
  const [quickPayOpen, setQuickPayOpen] = useState(false);
  // ADR-028 "Masayı Değiştir" (Karar H) — sipariş ekranından da açılabilir.
  // Yalnız dine_in + persisted sipariş için (buton koşulu handleTransferTable).
  const [moveOpen, setMoveOpen] = useState(false);

  const handleBack = () => navigate('/tables');
  // Müşteri butonu — v3 paritesi: hem dine_in hem takeaway'de aktif.
  //   - takeaway yeni sipariş     → picker aç
  //   - takeaway düzenleme        → picker AÇILMAZ (müşteri siparişe bağlı, sabit)
  //   - dine_in yeni sipariş      → picker aç (henüz persist edilmemiş cart)
  //   - dine_in persisted sipariş → picker aç → PATCH /orders/:id/customer (Session 53).
  const handleCustomer = () => {
    if (isTakeaway && isTakeawayEdit) return;
    setCustomerPickerOpen(true);
  };
  const handlePrint = () => undefined;
  // ADR-028: taşıma yalnız persisted dine_in siparişinde anlamlı. Buton zaten
  // dine_in + hasPersisted koşuluyla render edilir; guard belt-and-suspenders.
  const handleTransferTable = () => {
    if (isTakeaway || persistedOrderId === null) return;
    setMoveOpen(true);
  };

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

  const handleModalConfirm = (payload: import('./useOrderCart').CartItemEditPayload) => {
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

  /**
   * Pending cart -> server payload. dine_in + takeaway için ortak şekil
   * (TakeawayOrderItemInput dine_in OrderItemCreateInput superset'idir).
   */
  const buildItemsPayload = () =>
    cart.items.map((it) => ({
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

  const handleSave = async () => {
    if (!cart.isDirty || isSaving) return;

    if (isTakeaway) {
      // Düzenleme modu: mevcut sipariş — pending kalemleri ekle (POST
      // /orders/:id/items). Müşteri ve ödeme tipi zaten siparişe bağlı,
      // tekrar sorulmaz. Backend addItems takeaway'i de kapsıyor (type-agnostic).
      if (isTakeawayEdit && persistedOrderId !== null) {
        const items = buildItemsPayload();
        try {
          await addItems.mutateAsync({ orderId: persistedOrderId, items });
          toast.success(t('order.adisyon.saveSuccess'));
          cart.clear();
          void queryClient.invalidateQueries({ queryKey: ['tables'] });
          navigate('/tables');
        } catch (err) {
          toast.error(extractError(err, t('order.adisyon.saveError')));
        }
        return;
      }
      // Yeni sipariş akışı (ADR-017 ekran 3): müşteri zorunlu — yoksa picker'ı aç.
      if (selectedCustomer === null) {
        setCustomerPickerOpen(true);
        return;
      }
      // Müşteri seçili → ödeme tipi modal'ı (ekran 4) → seçim handler.
      setPaymentMethodOpen(true);
      return;
    }

    // dine_in flow — ADR-013 §1+§2.
    if (!table) return;
    const items = buildItemsPayload();
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
          // v3 paritesi: dine_in siparişine de müşteri atanabilir.
          // Yalnız yeni sipariş aşamasında — persisted sipariş için PATCH v5.1.
          ...(selectedCustomer !== null
            ? { customerId: selectedCustomer.id }
            : {}),
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

  /** Takeaway ekran 4: ödeme tipi seçildi -> POST /orders type=takeaway. */
  const handleTakeawayPaymentSelect = async (method: 'cash' | 'card') => {
    if (selectedCustomer === null || cart.items.length === 0) return;
    try {
      await createTakeaway.mutateAsync({
        customerId: selectedCustomer.id,
        plannedPaymentType: method,
        items: buildItemsPayload(),
      });
      toast.success(t('takeaway.success.created'));
      setPaymentMethodOpen(false);
      cart.clear();
      navigate('/tables');
    } catch (err) {
      toast.error(extractError(err, t('takeaway.errors.saveFailed')));
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

  if (!isTakeaway && !table) {
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
  // splitOpen / quickPayOpen state'leri yukarıda hook bloğunda; aşağı sadece
  // handler'lar (saf fonksiyon, hook çağrısı yok).
  const handleOpenPayment = () => {
    if (persistedOrderId === null) {
      toast.info(t('order.adisyon.saveBeforePayment'));
      return;
    }
    setSplitOpen(true);
  };
  const handleQuickPay = () => {
    if (persistedOrderId === null) {
      toast.info(t('order.adisyon.saveBeforePayment'));
      return;
    }
    setQuickPayOpen(true);
  };

  let actionsSlot: React.ReactNode = null;
  if (cart.isDirty) {
    actionsSlot = (
      <button
        type="button"
        onClick={handleSave}
        disabled={isSaving}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg text-[14px] font-bold text-white shadow-sm transition-all duration-[120ms] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 disabled:cursor-not-allowed disabled:opacity-60"
        style={{ minHeight: 46, background: 'var(--v3-purple, #7c3aed)' }}
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
      <div className="grid grid-cols-2" style={{ gap: 8 }}>
        <button
          type="button"
          onClick={handleOpenPayment}
          className="inline-flex items-center justify-center gap-2 rounded-lg border-2 text-[14px] font-bold transition-all duration-[120ms] hover:bg-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          style={{
            minHeight: 46,
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
          className="inline-flex items-center justify-center gap-2 rounded-lg text-[14px] font-bold text-white shadow-sm transition-all duration-[120ms] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          style={{ minHeight: 46, background: 'var(--v3-success, #10b981)' }}
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
          tableCode={tableLabel}
          areaName={areaName}
          hasPersistedOrder={activePersistedCount > 0}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          onBack={handleBack}
          onCustomer={handleCustomer}
          onPrint={handlePrint}
          {...(isTakeaway
            ? {
                titleOverride: t('takeaway.title'),
                // Düzenleme modunda müşteri siparişten gelir; yeni akışta
                // picker sonrası state'ten gelir.
                subtitleOverride:
                  (isTakeawayEdit
                    ? persistedCustomerName
                    : selectedCustomer?.fullName) ?? null,
              }
            : {})}
        />

        <ProductCatalog
          searchTerm={searchTerm}
          activeCategoryId={activeCategoryId}
          onChangeCategory={handleChangeCategory}
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
        {...(!isTakeaway ? { onTransferTable: handleTransferTable } : {})}
        onClose={handleBack}
      />

      <VoidItemConfirmDialog
        target={voidTarget}
        onOpenChange={(v) => !v && setVoidTarget(null)}
        onConfirm={handleVoidConfirm}
        isVoiding={updateItem.isPending}
      />

      <QuickPaymentModal
        open={quickPayOpen}
        onOpenChange={setQuickPayOpen}
        orderId={persistedOrderId}
        amountCents={persistedSubtotalCents}
        hasTable={true}
        onSuccess={(closed) => {
          void queryClient.invalidateQueries({ queryKey: ['tables'] });
          if (closed) {
            navigate('/tables');
          }
        }}
      />

      <DetailedPaymentModal
        open={splitOpen}
        onOpenChange={setSplitOpen}
        tableCode={tableLabel}
        orderId={persistedOrderId}
        hasTable={true}
        onCompleted={() => {
          void queryClient.invalidateQueries({ queryKey: ['tables'] });
          void persistedQuery.refetch();
        }}
      />

      {/* CustomerPickerModal: hem dine_in hem takeaway için (v3 paritesi). */}
      <CustomerPickerModal
        open={customerPickerOpen}
        onOpenChange={setCustomerPickerOpen}
        onPick={async (customer) => {
          setCustomerPickerOpen(false);
          // Persisted dine_in: PATCH /orders/:id/customer (Session 53).
          // Persisted takeaway-edit: handleCustomer zaten erken döner; buraya
          // gelmez. dine_in yeni / takeaway yeni: state'e set, save sırasında
          // customerId gönderilir.
          if (!isTakeaway && persistedOrderId !== null) {
            try {
              await assignCustomer.mutateAsync({
                orderId: persistedOrderId,
                customerId: customer.id,
              });
              toast.success(t('order.customer.assignSuccess'));
            } catch (err) {
              const code =
                isAxiosError(err) &&
                typeof (err.response?.data as { code?: string } | undefined)
                  ?.code === 'string'
                  ? ((err.response!.data as { code: string }).code)
                  : '';
              const msg =
                code !== ''
                  ? t(`order.errors.${code}`, {
                      defaultValue: t('order.customer.assignError'),
                    })
                  : t('order.customer.assignError');
              toast.error(msg);
            }
            return;
          }
          // Yeni sipariş akışı (henüz persist edilmemiş cart): state'e set.
          setSelectedCustomer(customer);
          // Takeaway yeni siparişte: müşteri seçildikten sonra cart doluysa
          // direkt ödeme tipi modal'ına geç (ADR-017 ekran 3→4).
          if (isTakeaway && !isTakeawayEdit && cart.items.length > 0) {
            setPaymentMethodOpen(true);
          }
        }}
      />

      {/* PaymentMethodModal yalnız takeaway yeni sipariş akışında. */}
      {isTakeaway && (
        <PaymentMethodModal
          open={paymentMethodOpen}
          onOpenChange={setPaymentMethodOpen}
          onSelect={(method) => {
            void handleTakeawayPaymentSelect(method);
          }}
          isSubmitting={createTakeaway.isPending}
        />
      )}

      {/* ADR-028 "Masayı Değiştir" — aktif dine_in siparişini boş masaya taşı.
          Başarı/yarış (TABLE_ALREADY_OCCUPIED) sonrası board'a dön: bu ekran
          eski masayı gösteriyordu, taşındıktan sonra burada kalmak anlamsız. */}
      <MoveTableModal
        open={moveOpen}
        onOpenChange={setMoveOpen}
        sourceLabel={tableLabel}
        orderId={persistedOrderId}
        sourceTableId={table?.id ?? null}
        allTables={tablesQuery.data ?? []}
        areas={areasQuery.data ?? []}
        onMoved={() => {
          void queryClient.invalidateQueries({ queryKey: ['tables'] });
          navigate('/tables');
        }}
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
