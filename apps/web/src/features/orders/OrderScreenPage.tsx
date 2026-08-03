import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ClipboardList, CreditCard, Loader2, Save, Zap } from 'lucide-react';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { formatMoney } from '@restoran-pos/shared-domain';
import { useSocketEvent } from '../../lib/socket';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useTables, useAreas } from '../tables/api';
import { tableDisplayNumber } from '../tables/utils/tableLabel';
import { useCustomer } from '../customers/api/customers';
import { useCategoriesAdmin } from '../admin/menu-categories/api';
import { useProductsAdmin, type ApiProduct } from '../admin/menu-products/api';
import { OrderScreenHeader } from './components/OrderScreenHeader';
import { AdisyonPanel } from './components/AdisyonPanel';
import { ProductCatalog } from './components/ProductCatalog';
import { VoidItemConfirmDialog } from './components/VoidItemConfirmDialog';
import { LeaveStagedConfirmDialog } from './components/LeaveStagedConfirmDialog';
import { ItemDetailModal } from './components/ItemDetailModal';
import { MoveItemToTableModal } from './components/MoveItemToTableModal';
import { useAuthStore } from '../../store/auth';
import { OrderProductDetailModal } from './components/OrderProductDetailModal';
import {
  CustomerPickerModal,
  type PickedCustomer,
} from './components/CustomerPickerModal';
import { PaymentMethodModal } from './components/PaymentMethodModal';
import { QuickPaymentModal } from '../payment/components/QuickPaymentModal';
import { DetailedPaymentModal } from '../payment/components/DetailedPaymentModal';
import { usePrintBill, useSplitState } from '../payment/api';
import { MoveTableModal } from '../tables/components/MoveTableModal';
import { MergeTableModal } from '../tables/components/MergeTableModal';
import { useOrderCart, type CartItem } from './useOrderCart';
import { useStagedItemEdits, mergeStagedItem } from './useStagedItemEdits';
import {
  useAddOrderItems,
  useAssignCustomer,
  useCreateOrder,
  useCreateTakeawayOrder,
  useOrderById,
  useUpdateOrderItem,
  useUpdateOrderNote,
  type ApiOrderItem,
  type OrderItemPatch,
} from './api';
import { OrderNoteModal } from './components/OrderNoteModal';

/**
 * Masa Detay / Sipariş Alma — ADR-013 (Phase 2).
 *
 * 3-pane layout (ADR-013 §4):
 *   - Üst: OrderScreenHeader (sol sütun)
 *   - Orta sol: ProductCatalog (PR-2)
 *   - Sağ: AdisyonPanel (PR-3 pending + PR-4 persisted + Kaydet butonu)
 *
 * PR-4 (Kaydet) akışı (ADR-013 §1+§2):
 *   1. tables refetch → active_order_id: masada açık sipariş var mı (status='open')
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

  // Caller ID "Sipariş Aç" (ADR-016 §11) — yeni paket siparişte müşteri
  // ön-seçim/ön-doldurma: bilinen müşteri (customerId) çekilip ön-seçilir;
  // bilinmeyen arayan (phone) → müşteri seçici telefonla ön-dolu açılır.
  const callCustomerId =
    isTakeaway && !isTakeawayEdit ? searchParams.get('customerId') : null;
  const callPhone =
    isTakeaway && !isTakeawayEdit ? searchParams.get('phone') : null;

  const queryClient = useQueryClient();
  const tablesQuery = useTables();
  const areasQuery = useAreas();
  const printBill = usePrintBill();

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
  // ADR-013 Amd4 K1 — KAYITLI kalem düzenlemelerinin bekleyen katmanı. Modal
  // "Kaydet" buraya yazar; sunucuya yalnız ana adisyon "Kaydet"i gönderir (K2).
  const stagedEdits = useStagedItemEdits();
  // Amd4 K8 — "kaydedilmemiş değişiklik var" tek yerden: yeni ürün VEYA kayıtlı
  // kalem düzenlemesi/silmesi. Kaydet butonu, ödeme kapısı ve Yazdır kilidi
  // bunu okur.
  const isDirty = cart.isDirty || stagedEdits.isDirty;

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
  // Kısmi/ayrı-ayrı ödeme sonrası masa AÇIK kalabilir (ADR-014 §12 — split
  // payment_scope='item' closeOrder göndermez); adisyon ekranında alınan
  // tutarın kaybolmaması için split-state'ten okunur (2026-07-30 kullanıcı
  // isteği — "kapanmayan masanın adisyon sayfasında alınan tutar yazılmalı").
  const splitStateQuery = useSplitState(persistedOrderId);
  const paidTotalCents = splitStateQuery.data?.totals.paid_total_cents ?? 0;
  /**
   * ADR-013 Amd2 paritesi (S104, mobil #454) — ürün bazında ADİSYONA KAYITLI
   * adet; ürün kartında `saved + pending` gösterilir. `cancelled` sayılmaz;
   * `product_id` null (silinmiş ürün snapshot'ı) atlanır.
   */
  const savedQtyByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of persistedItems) {
      if (it.status === 'cancelled' || it.product_id === null) continue;
      map.set(it.product_id, (map.get(it.product_id) ?? 0) + it.quantity);
    }
    return map;
  }, [persistedItems]);
  // Server otorite (ADR-013 §2 + Migration 020 recalc): orders.total_cents zaten
  // cancelled + is_comped satırlarını dışlıyor. UI sadece okur.
  const persistedSubtotalCents = persistedQuery.data?.order.total_cents ?? 0;

  const createOrder = useCreateOrder();
  const createTakeaway = useCreateTakeawayOrder();
  const addItems = useAddOrderItems();
  const updateItem = useUpdateOrderItem();
  // Amd4 K5: commit artık kalem yamalarını da içeriyor → updateItem de sayılır
  // (aksi halde commit ortasında Kaydet tekrar basılabilirdi).
  const isSaving =
    createOrder.isPending ||
    addItems.isPending ||
    createTakeaway.isPending ||
    updateItem.isPending;

  // ADR-013 Amendment 1 K9 — attempt-sabit idempotency key. Aynı Kaydet
  // denemesinin retry'ları (ör. timeout sonrası tekrar tıklama) AYNI key'i
  // gönderir → sunucu tek sipariş / tek batch garantiler (200 replay, duplike
  // yok). Başarıda taze key üretilir (sonraki batch için). create =
  // idempotencyKey, addItems = batchKey — ikisi de bu attempt token'ı taşır.
  const saveKeyRef = useRef<string>(crypto.randomUUID());

  // Müşteri picker state — v3 paritesi: hem dine_in hem takeaway'de
  // kullanılır. Takeaway için zorunlu (ADR-017), dine_in için opsiyonel
  // (yeni sipariş aşamasında atanabilir; persisted dine_in için PATCH v5.1).
  const [selectedCustomer, setSelectedCustomer] =
    useState<PickedCustomer | null>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [paymentMethodOpen, setPaymentMethodOpen] = useState(false);

  // Caller ID (ADR-016 §11): bilinen müşteriyi çek + paket siparişe ön-seç
  // (picker açılmaz). Zaten seçili ise override etme (idempotent).
  const callCustomerQuery = useCustomer(callCustomerId);
  useEffect(() => {
    const c = callCustomerQuery.data;
    if (c === undefined || c === null) return;
    const primary = c.phones.find((p) => p.isPrimary) ?? c.phones[0] ?? null;
    setSelectedCustomer(
      (prev) =>
        prev ?? {
          id: c.id,
          fullName: c.fullName,
          primaryPhone: primary?.normalizedPhone ?? null,
        },
    );
  }, [callCustomerQuery.data]);

  // Bilinmeyen arayan (phone var, müşteri YOK) → seçiciyi telefonla ön-dolu aç.
  // S105: `callToTakeawayRoute` artık bilinen müşteride de `phone` geçiriyor
  // (Kişi butonu ön-doldurması için) → burada `callCustomerId` kontrolü ŞART,
  // aksi halde müşterisi belli arayanda seçici gereksiz yere açılırdı.
  useEffect(() => {
    if (callCustomerId !== null) return;
    if (callPhone !== null && callPhone.length > 0) setCustomerPickerOpen(true);
  }, [callPhone, callCustomerId]);

  // Persisted dine_in / takeaway-edit modunda müşteri zaten siparişe bağlı;
  // header subtitle için isim çekilir. Müşteri silinmiş ise (customer_id null)
  // header fallback gösterir.
  const persistedCustomerId = persistedQuery.data?.order.customer_id ?? null;
  const persistedCustomerQuery = useCustomer(persistedCustomerId);
  const persistedCustomerName = persistedCustomerQuery.data?.fullName ?? null;

  /**
   * S105 — "Kişi" butonuna basıldığında seçicinin göstereceği müşteri.
   * Kaydedilmiş siparişte müşteri SUNUCUDAN gelir (`selectedCustomer` state'i
   * o akışta boştur); yeni sipariş aşamasında seçilen state'ten. Seçici artık
   * bu değeri "seçili" gösterip arama kutusunu ön-doldurur — eskiden her
   * açılışta bomboş başlıyordu.
   */
  const activeCustomer = useMemo<PickedCustomer | null>(() => {
    const c = persistedCustomerQuery.data;
    if (c !== undefined && c !== null) {
      const primary = c.phones.find((p) => p.isPrimary) ?? c.phones[0] ?? null;
      return {
        id: c.id,
        fullName: c.fullName,
        primaryPhone: primary?.normalizedPhone ?? null,
      };
    }
    return selectedCustomer;
  }, [persistedCustomerQuery.data, selectedCustomer]);

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

  // Amd4: hedefler ID ile tutulur — böylece hem sunucu tazelemesi hem bekleyen
  // yama değişimi modal açıkken doğru satıra yansır (kopya nesne bayatlamaz).
  const [voidTargetId, setVoidTargetId] = useState<string | null>(null);
  // Amd4 — kayıtlı kalem değişikliği bekliyorken çıkış onayı (K9 revizyonu).
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  // ADR-013 Amd3 — kayıtlı kalem detay modalı.
  const [detailTargetId, setDetailTargetId] = useState<string | null>(null);
  // 2026-08-03 canlı talep — sipariş-seviyesi not modalı.
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const updateOrderNote = useUpdateOrderNote();
  // ADR-035 S13 — "Başka Masaya Taşı" hedef seçici; detay modalinden devralır.
  const [moveItemTargetId, setMoveItemTargetId] = useState<string | null>(null);
  // Amd3 K3: fiyat/adet/not HERKESE açık, İKRAM admin/kasiyerde kaldı (§9.2)
  // → yetkisiz butonu hiç render etme (ADR-026 K6).
  const canComp = useAuthStore(
    (st) => st.user?.role === 'admin' || st.user?.role === 'cashier',
  );
  // ADR-035 S9 — kalem taşıma admin/kasiyer/GARSON (kitchen hariç; "koruma
  // rolde değil ödeme kuralında"). Yetkisiz rolde buton hiç render edilmez
  // (canComp ile aynı ilke, ADR-026 K6). S1: yalnız masa siparişleri.
  const canMoveItemRole = useAuthStore(
    (st) =>
      st.user?.role === 'admin' ||
      st.user?.role === 'cashier' ||
      st.user?.role === 'waiter',
  );
  const canMoveItem = canMoveItemRole && !isTakeaway;
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
  // 🐛 Canlı bug fix (2026-08-02) — eskiden `OrderProductDetailModal`'a bu
  // obje JSX'te INLINE literal olarak geçiyordu, yani her OrderScreenPage
  // render'ında YENİ bir referans üretiyordu (editingItem'ın kendisi
  // değişmese bile). Modal'ın populate-effect'i bunu bağımlılık olarak
  // izlediğinden, sayfa herhangi bir sebeple (realtime event, başka bir
  // query) yeniden render olunca kullanıcının modal içinde yaptığı özellik
  // seçimi sessizce sıfırlanıyordu. `useMemo` ile referans yalnız
  // `editingItem` gerçekten değişince değişir.
  const modalInitial = useMemo(
    () =>
      editingItem === null
        ? null
        : {
            selectedAttributes: editingItem.selectedAttributes,
            variant: editingItem.variant,
            note: editingItem.note,
            quantity: editingItem.quantity,
            unitPriceOverrideCents: editingItem.unitPriceOverrideCents,
          },
    [editingItem],
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
  // ADR-029 "Adisyon Aktar" (Karar H) — sipariş ekranından da açılabilir.
  // Yalnız dine_in + persisted sipariş için (buton koşulu handleMergeTable).
  // NOT: early return'lerin (Loader / tableNotFound) ÜSTÜNDE — hooks count sabit.
  const [mergeOpen, setMergeOpen] = useState(false);
  // Mobil (<768px) AdisyonPanel bottom-sheet — chip task_341abb30 responsive ayağı.
  // md+ değişmez (v3 paritesi 2 sütun); <md tek sütun + sheet.
  const [adisyonSheetOpen, setAdisyonSheetOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const leaveScreen = () => navigate('/tables');
  // Geri/kapat: yeni ürün sepeti için DOĞRUDAN çıkılır — kaydedilmemiş sepet
  // uyarısı kullanıcı talebiyle kaldırılmıştı (S84) ve öyle kalır.
  // Amd4 (S105 ürün sahibi kararı): KAYITLI kaleme dokunulmuşsa (düzenleme veya
  // "silinecek" işareti) sessiz kayıp riskli — silme kararı onaydan geçmiştir,
  // düzeltilen kalem zaten mutfağa gitmiştir → yalnız bu durumda onay sorulur.
  const handleBack = () => {
    if (stagedEdits.isDirty) {
      setLeaveConfirmOpen(true);
      return;
    }
    leaveScreen();
  };
  // Müşteri butonu — v3 paritesi: hem dine_in hem takeaway'de aktif.
  //   - takeaway yeni sipariş     → picker aç
  //   - takeaway düzenleme        → picker AÇILMAZ (müşteri siparişe bağlı, sabit)
  //   - dine_in yeni sipariş      → picker aç (henüz persist edilmemiş cart)
  //   - dine_in persisted sipariş → picker aç → PATCH /orders/:id/customer (Session 53).
  // S105 [USER]: paket siparişi düzenlerken de açılır. Eskiden sessizce
  // `return` ediyordu — buton hiç tepki vermiyordu ve yanlış müşteriye açılmış
  // paket siparişi düzeltmenin yolu yoktu. Seçici artık mevcut müşteriyi
  // seçili gösterir; farklı biri seçilirse PATCH ile değiştirilir.
  const handleCustomer = () => {
    setCustomerPickerOpen(true);
  };
  // W9-HCI-01: Yazdır artık on-demand adisyon fişi bastırır (TablesListPage
  // "Yazdır" paritesi). Fiş SUNUCU (persisted) durumunu basar. Buton disabled
  // iken (persisted yok / kaydedilmemiş cart / print pending) tıklanamaz —
  // guard defensif + persistedOrderId null-narrowing (bayat/çift fiş önlenir).
  // Amd4 K8: bekleyen kalem düzenlemesi de fişi bayatlatır (fiş SUNUCU
  // durumunu basar) → Yazdır o durumda da kilitli.
  const printDisabled =
    persistedOrderId === null || isDirty || printBill.isPending;
  const handlePrint = () => {
    if (printDisabled || persistedOrderId === null) return;
    // toast.promise → tıklama anında "gönderiliyor…" (async enqueue görünürlüğü);
    // otomatik başarılı/hata (hci gate, TablesListPage deseni).
    void toast.promise(printBill.mutateAsync({ orderId: persistedOrderId }), {
      loading: t('payment.tableActions.printing'),
      success: t('payment.tableActions.printSuccess'),
      error: (err: unknown) =>
        extractError(err, t('payment.tableActions.printError')),
    });
  };
  // ADR-028: taşıma yalnız persisted dine_in siparişinde anlamlı. Buton zaten
  // dine_in + hasPersisted koşuluyla render edilir; guard belt-and-suspenders.
  const handleTransferTable = () => {
    if (isTakeaway || persistedOrderId === null) return;
    setMoveOpen(true);
  };
  // ADR-029: birleştirme yalnız persisted dine_in siparişinde anlamlı. Buton
  // zaten dine_in + hasPersisted koşuluyla render edilir; guard belt-and-suspenders.
  const handleMergeTable = () => {
    if (isTakeaway || persistedOrderId === null) return;
    setMergeOpen(true);
  };

  // ADR-013 §10 Karar 10.1 + Amendment 2 K1: kart GÖVDESİ → modal yok, her
  // dokunuş YENİ satır (parti modeli — mobil ADR-026 Amd3 paritesi).
  const handleAddProduct = (product: ApiProduct) => cart.addItem(product);
  // Amd2 K2: stepper "+"/"−" en yeni hızlı-ekleme satırını hedefler. Satır
  // seçimi cart'ın içinde (opak rowId dışarıdan üretilemez).
  const handleIncrementProduct = (product: ApiProduct) =>
    cart.incrementProduct(product);
  const handleDecrementProduct = (product: ApiProduct) =>
    cart.decrementProduct(product);

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

  /** Kalemin ÜRÜNÜNE ait porsiyonlar — hem detay modalı hem Amd4 K6 fiyat
   *  ön-gösterimi bunu kullanır (katalog cache'inden; ek istek yok). */
  const variantsOfItem = (item: ApiOrderItem) =>
    item.product_id === null
      ? []
      : productsById.get(item.product_id)?.variants ?? [];

  // Amd4 K1 "merged display" — ekranda kayıtlı kalem + bekleyen yama gösterilir.
  // Sunucu cache'i (react-query) commit'e kadar DEĞİŞMEZ; birleşim burada türetilir.
  const mergedPersistedItems = useMemo(
    () =>
      persistedItems.map((it) =>
        mergeStagedItem(
          it,
          stagedEdits.staged.get(it.id),
          it.product_id === null
            ? []
            : productsById.get(it.product_id)?.variants ?? [],
        ),
      ),
    [persistedItems, stagedEdits.staged, productsById],
  );

  const detailTarget =
    detailTargetId === null
      ? null
      : persistedItems.find((it) => it.id === detailTargetId) ?? null;
  const voidTarget =
    voidTargetId === null
      ? null
      : mergedPersistedItems.find((it) => it.id === voidTargetId) ?? null;
  // ADR-035 — taşıma SUNUCU gerçeğiyle çalışır (bekleyen yama uygulanmaz):
  // detailTarget gibi ham persistedItems'tan okunur.
  const moveItemTarget =
    moveItemTargetId === null
      ? null
      : persistedItems.find((it) => it.id === moveItemTargetId) ?? null;

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

  /** ADR-013 Amd3 — kalem detay kaydet (adet/fiyat/not). Fiş BASILMAZ (K6). */
  /**
   * Amd4 K2 — detay modalının "Kaydet"i artık SUNUCUYA GİTMEZ: değişikliği
   * bekleyen yama olarak biriktirir. Mutfağa/kasaya inmesi ana adisyon
   * "Kaydet"i ile olur (K5 commit).
   */
  const handleDetailSave = (patch: OrderItemPatch) => {
    if (detailTarget === null) return;
    stagedEdits.stageEdit(detailTarget, patch);
    setDetailTargetId(null);
    toast.success(t('order.itemDetail.staged'));
  };

  /** Amd3 — modaldan ikram toggle (yetki backend'de; buton yalnız admin/kasiyerde).
   *  Amd4 K2: ikram da bekleyen yamaya yazılır, commit'te uygulanır. */
  const handleDetailComp = () => {
    if (detailTarget === null) return;
    const merged = mergeStagedItem(
      detailTarget,
      stagedEdits.staged.get(detailTarget.id),
      variantsOfItem(detailTarget),
    );
    stagedEdits.stageEdit(detailTarget, { isComped: !merged.is_comped });
    setDetailTargetId(null);
    toast.success(t('order.itemDetail.staged'));
  };

  /**
   * Amd4 K3/K4 — silme onayı STAGE anında alınır; satır "silinecek" işaretlenir.
   * Sunucuya (ve mutfağa iptal fişi olarak) ana "Kaydet" ile iner; o ana kadar
   * geri alınabilir. ADR-014 Amd1 K7 auto-cancel commit'te değerlendirilir.
   */
  const handleVoidConfirm = () => {
    if (voidTargetId === null) return;
    stagedEdits.stageVoid(voidTargetId);
    setVoidTargetId(null);
    toast.success(t('order.adisyon.voidStaged'));
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
      // ADR-013 Amendment 5 K1/K11 — dine_in + takeaway TEK ortak yol
      // (buildItemsPayload), override otomatik ikisine de taşınır.
      ...(it.unitPriceOverrideCents !== null
        ? { unitPriceOverrideCents: it.unitPriceOverrideCents }
        : {}),
    }));

  /**
   * Amd4 K5 (b) — bekleyen kalem yamalarını sunucuya uygular.
   *
   * Her yama BAĞIMSIZ, atomik, audit'li ve fiş etkilidir (basılan kâğıt geri
   * alınamaz) → **best-effort**: hepsi denenir, başarılı olanlar temizlenir.
   * Uygulanmış yamalar GERİ ALINMAZ — sunucu otoritedir.
   *
   * Başarısızlıkta (S106 fix): sunucu KESİN reddettiyse (4xx yanıt — istek
   * işlendi, belirsizlik yok) yama da geri alınır (ekran sunucu gerçeğine
   * döner, "SİLİNECEK"/değişmiş rozeti kalıcı asılı kalmaz). Belirsiz hatada
   * (ağ kopması/timeout/5xx — istek sunucuda aslında uygulanmış olabilir)
   * yama bilerek bekleyen katmanda KALIR — geri alıp kullanıcıya "tekrar gir"
   * dersek `updateItem` idempotency-key taşımadığı için mükerrer adet/fiyat
   * riski doğar.
   */
  const commitStagedEdits = async (
    orderId: string,
  ): Promise<{
    failed: number;
    autoCancelled: boolean;
    errorMessage: string | null;
  }> => {
    const committed: string[] = [];
    const failedIds: string[] = [];
    const definiteRejectionIds: string[] = [];
    let autoCancelled = false;
    // S106 canlı denetim bulgusu — eskiden bare `catch {}` hatayı tamamen
    // yutuyordu (ör. ORDER_TOTAL_BELOW_PAID sebebi hiç görünmüyordu) ve
    // başarısız kalem `stagedEdits` haritasında SONSUZA DEK asılı kalıyordu
    // (yalnız `committed` id'leri temizleniyordu) — ekranda "SİLİNECEK"
    // rozeti + yanlış (düşük) toplam kalıcı görünüyordu, sunucu DB'si
    // aslında tamamen tutarlıydı (yalnız istemci-yanılsaması).
    let firstError: unknown = null;
    // 🐛 Canlı bug fix (2026-08-02) — birden fazla kalem yaması (ör. iki ayrı
    // silme) aynı Kaydet'te tek tek gönderiliyordu, HER biri kendi kasa fişini
    // basıyordu (N yama = N fiş, ilki de henüz sıradaki yamalar işlenmeden
    // basılıyordu). Yalnız DİZİNİN SONUNCUSU kasa fişini basar
    // (`printPacking`); öncekiler atlar — tek ve DOĞRU (tüm yamalar
    // uygulanmış) fiş.
    const entries = [...stagedEdits.staged.entries()];
    for (let i = 0; i < entries.length; i++) {
      const [itemId, patch] = entries[i]!;
      const isLast = i === entries.length - 1;
      try {
        const { order } = await updateItem.mutateAsync({
          orderId,
          itemId,
          patch: { ...patch, printPacking: isLast },
        });
        committed.push(itemId);
        // ADR-014 Amd1 K7 — son canlı kalem iptal edilince sipariş backend'de
        // otomatik kapanır; kalan yamaların hedefi kalmadığı için durulur.
        if (order.status === 'cancelled') {
          autoCancelled = true;
          break;
        }
      } catch (err) {
        failedIds.push(itemId);
        firstError ??= err;
        // security-review bulgusu — KESİN ret (sunucu 4xx yanıtı verdi, ör.
        // ORDER_TOTAL_BELOW_PAID) ile BELİRSİZ hata (ağ kopması/timeout/5xx)
        // AYNI muamele görmemeli: timeout'ta istek sunucuda aslında BAŞARILI
        // olmuş olabilir — o durumda yamayı geri alıp kullanıcıya "tekrar gir"
        // dersek `updateItem` idempotency-key TAŞIMADIĞI için mükerrer
        // adet/fiyat riski doğar. Yalnız sunucunun GERÇEKTEN yanıtladığı
        // (4xx — istek işlendi ve reddedildi, belirsizlik yok) durumda geri al.
        if (
          isAxiosError(err) &&
          err.response !== undefined &&
          err.response.status < 500
        ) {
          definiteRejectionIds.push(itemId);
        }
      }
    }
    stagedEdits.clearMany(committed);
    // Yalnız KESİN reddedilenleri geri al (yukarıdaki ayrım) — belirsiz
    // hatalı kalem bilerek staged bırakılır (eski davranış, güvenli taraf).
    stagedEdits.clearMany(definiteRejectionIds);
    return {
      failed: failedIds.length,
      autoCancelled,
      errorMessage:
        failedIds.length > 0
          ? extractError(
              firstError,
              t('order.adisyon.partialSaveError', {
                count: failedIds.length,
              }),
            )
          : null,
    };
  };

  const handleSave = async () => {
    if (!isDirty || isSaving) return;

    if (isTakeaway) {
      // Düzenleme modu: mevcut sipariş — pending kalemleri ekle (POST
      // /orders/:id/items). Müşteri ve ödeme tipi zaten siparişe bağlı,
      // tekrar sorulmaz. Backend addItems takeaway'i de kapsıyor (type-agnostic).
      if (isTakeawayEdit && persistedOrderId !== null) {
        const items = buildItemsPayload();
        try {
          // K5 (a): ÖNCE yeni ürünler.
          // 🐛 Canlı bug fix (2026-08-02) — bekleyen kalem yaması da varsa
          // (K5b'de gönderilecek) bu adımın kendi kasa-fişi basımı atlanır;
          // fiş K5b'nin SONUNDA (tüm yamalar işlendikten sonra) basılır.
          if (items.length > 0) {
            await addItems.mutateAsync({
              orderId: persistedOrderId,
              items,
              batchKey: saveKeyRef.current,
              printPacking: !stagedEdits.isDirty,
            });
            cart.clear();
            saveKeyRef.current = crypto.randomUUID();
          }
          // K5 (b): SONRA bekleyen kalem yamaları.
          if (stagedEdits.isDirty) {
            const { failed, autoCancelled, errorMessage } =
              await commitStagedEdits(persistedOrderId);
            if (autoCancelled) {
              toast.success(t('order.adisyon.autoCancelled'));
              void queryClient.invalidateQueries({ queryKey: ['tables'] });
              navigate('/tables');
              return;
            }
            if (failed > 0) {
              toast.error(
                errorMessage ??
                  t('order.adisyon.partialSaveError', { count: failed }),
              );
              return;
            }
          }
          toast.success(t('order.adisyon.saveSuccess'));
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

      // Amd4 K5 (a): ÖNCE yeni ürünler. Sıra kasıtlı — yeni kalemler önce
      // eklenince sipariş commit boyunca en az bir canlı kalem taşır, böylece
      // tüm kayıtlı kalemler "silinecek" işaretli olsa bile ADR-014 Amd1
      // auto-cancel yanlışlıkla tetiklenmez.
      if (items.length > 0) {
        if (targetOrderId !== null) {
          await addItems.mutateAsync({
            orderId: targetOrderId,
            items,
            batchKey: saveKeyRef.current,
          });
        } else {
          await createOrder.mutateAsync({
            tableId: table.id,
            orderType: 'dine_in',
            items,
            idempotencyKey: saveKeyRef.current,
            // v3 paritesi: dine_in siparişine de müşteri atanabilir.
            // Yalnız yeni sipariş aşamasında — persisted sipariş için PATCH v5.1.
            ...(selectedCustomer !== null
              ? { customerId: selectedCustomer.id }
              : {}),
          });
        }
        cart.clear();
        saveKeyRef.current = crypto.randomUUID();
      }

      // K5 (b): SONRA bekleyen kalem yamaları (yalnız kayıtlı sipariş varken
      // anlamlı — staged düzenleme zaten kayıtlı kalem gerektirir).
      if (stagedEdits.isDirty && targetOrderId !== null) {
        const { failed, autoCancelled, errorMessage } =
          await commitStagedEdits(targetOrderId);
        if (autoCancelled) {
          toast.success(t('order.adisyon.autoCancelled'));
          void queryClient.invalidateQueries({ queryKey: ['tables'] });
          navigate('/tables');
          return;
        }
        if (failed > 0) {
          toast.error(
            errorMessage ??
              t('order.adisyon.partialSaveError', { count: failed }),
          );
          return;
        }
      }

      toast.success(t('order.adisyon.saveSuccess'));
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

  // Persisted aktif kalemler (cancelled hariç) — header rozeti + Print buton
  // koşulu. Amd4: "silinecek" işaretli satırlar da düşülür (merged görünüm).
  const activePersistedCount = mergedPersistedItems.filter(
    (it) =>
      it.status !== 'cancelled' &&
      stagedEdits.staged.get(it.id)?.status !== 'cancelled',
  ).length;
  // Amd4 K6: bekleyen düzenleme yokken SUNUCU toplamı otoritedir (bugünkü
  // davranış). Bekleyen varken toplam merged satırlardan ön-gösterilir —
  // saf domain fonksiyonuyla (mergeStagedItem → calculateItemSubtotal).
  const persistedPreviewCents = stagedEdits.isDirty
    ? mergedPersistedItems.reduce((acc, it) => acc + it.total_cents, 0)
    : persistedSubtotalCents;
  const subtotalCents = cart.subtotalCents + persistedPreviewCents;
  const totalCents = subtotalCents;
  const hint = isDirty ? t('order.adisyon.saveHint') : null;

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

  // Amd4 K7 — bekleyen değişiklik varken ödeme yolu KAPALI: önce commit, sonra
  // öde (uncommitted tutarla tahsilat önlenir). Yeni-ürün paterniyle aynı.
  let actionsSlot: React.ReactNode = null;
  if (isDirty) {
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

  // AdisyonPanel md+ inline (3fr sütun) ile <md bottom-sheet arasında tek kaynak.
  // onClose bağlama-göre değişir: md+ = ekrandan çık (guard'lı); sheet = toparla.
  const renderAdisyonPanel = (onClose: () => void) => (
    <AdisyonPanel
      persistedItems={mergedPersistedItems}
      stagedItemIds={stagedEdits.staged}
      pendingItems={cart.items}
      subtotalCents={subtotalCents}
      totalCents={totalCents}
      paidTotalCents={paidTotalCents}
      hint={hint}
      actionsSlot={actionsSlot}
      onPendingIncrement={cart.incrementItem}
      onPendingDecrement={cart.decrementItem}
      onPendingRemove={cart.removeItem}
      onPendingEdit={handlePendingEdit}
      onPersistedVoid={(item) => setVoidTargetId(item.id)}
      onPersistedEdit={(item) => setDetailTargetId(item.id)}
      onPersistedUnstage={stagedEdits.unstage}
      {...(!isTakeaway ? { onTransferTable: handleTransferTable } : {})}
      {...(!isTakeaway ? { onMergeTable: handleMergeTable } : {})}
      orderNote={persistedQuery.data?.order.note ?? null}
      {...(persistedOrderId !== null
        ? { onEditNote: () => setNoteModalOpen(true) }
        : {})}
      onClose={onClose}
    />
  );

  // Mobil bar rozeti: siparişteki TÜM görünür kalem sayısı (kayıtlı + pending).
  // Bar total'i (pending + persisted) ile AYNI kapsam → "yüksek tutar / boş rozet"
  // yanlış okumasını önler (hci task_341abb30 review).
  const orderItemCount = activePersistedCount + cart.items.length;

  return (
    <div
      // S104 (ürün sahibi): adisyon paneli %30'du, dar ve sıkışık görünüyordu —
      // "Adisyo'da daha geniş, ferah ve okunabilir". %40'a çıkarıldı; ürün
      // ızgarası zaten geniş boşlukla çalışıyordu (kiosk ekranında sol taraf
      // büyük ölçüde boştu).
      className="grid h-screen w-full grid-cols-1 md:grid-cols-[6fr_4fr]"
      style={{
        background: 'var(--v3-bg-app, #F4F7FB)',
        borderBottom: '3px solid var(--v3-purple, #7C5CFA)',
        // Tek satırı viewport'a sabitle (minmax min-0). Aksi halde implicit satır
        // `auto` olur → sağ AdisyonPanel (aside, grid-item düzeyinde min-h-0 yok)
        // içerikle büyür → `h-full` sınırsız → iç `overflow-y-auto` liste
        // scroll etmez → BottomActionBar (Kaydet) ekran altına kayar. min-0 ile
        // satır viewport'a sabitlenir; çok kalemli siparişte liste scroll eder,
        // Kaydet her zaman görünür.
        gridTemplateRows: 'minmax(0, 1fr)',
      }}
    >
      {/* Sol sütun: header + catalog. <md: sabit alt-bar için pb-14 pay. */}
      <div className="grid min-h-0 grid-rows-[auto_1fr] overflow-hidden pb-14 md:pb-0">
        <OrderScreenHeader
          tableCode={tableLabel}
          areaName={areaName}
          hasPersistedOrder={activePersistedCount > 0}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          onBack={handleBack}
          onCustomer={handleCustomer}
          onPrint={handlePrint}
          printDisabled={printDisabled}
          printPending={printBill.isPending}
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
          onAddProduct={handleAddProduct}
          onIncrementProduct={handleIncrementProduct}
          onDecrementProduct={handleDecrementProduct}
          pendingQtyByProductId={cart.pendingQtyByProductId}
          savedQtyByProductId={savedQtyByProductId}
        />
      </div>

      {/* Sağ sütun (md+): AdisyonPanel inline — 3fr sütun, v3 paritesi. */}
      {isDesktop && renderAdisyonPanel(handleBack)}

      {/* Mobil (<768px): sabit alt-bar (canlı ürün sayısı + tutar) + AdisyonPanel
          bottom-sheet. Sheet ✕ = toparla (non-destructive); ekrandan çıkış YALNIZ
          header "Geri" (kaydedilmemiş sepet guard'ı ile). chip task_341abb30. */}
      {!isDesktop && (
        <>
          <button
            type="button"
            onClick={() => setAdisyonSheetOpen(true)}
            aria-label={t('order.adisyon.openSheet')}
            className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t bg-white px-4"
            style={{
              minHeight: 56,
              borderColor: 'var(--v3-border-subtle)',
              boxShadow: '0 -2px 8px rgba(0, 0, 0, 0.06)',
            }}
          >
            <span
              className="flex items-center gap-2"
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--v3-text-primary)',
              }}
            >
              <ClipboardList
                className="h-5 w-5"
                style={{ color: 'var(--v3-purple, #7C5CFA)' }}
              />
              {t('order.adisyon.title')}
              {orderItemCount > 0 && (
                <span
                  className="inline-flex items-center justify-center rounded-full text-white tabular-nums"
                  style={{
                    minWidth: 20,
                    height: 20,
                    padding: '0 6px',
                    fontSize: 12,
                    fontWeight: 700,
                    background: 'var(--v3-purple, #7C5CFA)',
                  }}
                >
                  {orderItemCount}
                </span>
              )}
            </span>
            <span
              className="tabular-nums"
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: 'var(--v3-text-primary)',
              }}
            >
              {formatMoney(totalCents)}
            </span>
          </button>

          <DialogPrimitive.Root
            open={adisyonSheetOpen}
            onOpenChange={setAdisyonSheetOpen}
          >
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
              <DialogPrimitive.Content
                className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl"
                aria-describedby={undefined}
              >
                <DialogPrimitive.Title className="sr-only">
                  {t('order.adisyon.title')}
                </DialogPrimitive.Title>
                {renderAdisyonPanel(() => setAdisyonSheetOpen(false))}
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
        </>
      )}

      {/* Amd4 K1 — modal BEKLEYEN değeri ön-doldurur (merged), sunucudakini
          değil: kullanıcı ikinci kez açtığında kendi değişikliğini görür. */}
      <ItemDetailModal
        item={
          detailTarget === null
            ? null
            : mergeStagedItem(
                detailTarget,
                stagedEdits.staged.get(detailTarget.id),
                variantsOfItem(detailTarget),
              )
        }
        onOpenChange={(open) => !open && setDetailTargetId(null)}
        canComp={canComp}
        canMove={canMoveItem}
        // ADR-035 S13 — taşıma ANLIK; bekleyen (kaydedilmemiş) değişiklik varken
        // kapalı. Ölçü, ödeme/Yazdır kapılarıyla AYNI kaynak: Amd4 K8 isDirty
        // (yeni ürün sepeti VEYA kayıtlı kalem yaması).
        moveBlocked={isDirty}
        onMove={() => {
          // Hedef masa seçicisine devreder (silme onayı deseninin ikizi).
          const targetId = detailTargetId;
          setDetailTargetId(null);
          setMoveItemTargetId(targetId);
        }}
        variants={detailTarget === null ? [] : variantsOfItem(detailTarget)}
        isSaving={false}
        onSave={handleDetailSave}
        onVoid={() => {
          // Silme onay diyaloguna devreder (K4: onay STAGE anında alınır).
          const targetId = detailTargetId;
          setDetailTargetId(null);
          setVoidTargetId(targetId);
        }}
        onToggleComp={handleDetailComp}
      />

      <VoidItemConfirmDialog
        target={voidTarget}
        onOpenChange={(v) => !v && setVoidTargetId(null)}
        onConfirm={handleVoidConfirm}
        isVoiding={false}
      />

      {/* Amd4 K9 revizyonu — kayıtlı kaleme dokunulmuş ve kaydedilmemişken
          çıkış onayı. Yeni ürün sepeti bu uyarıyı TETİKLEMEZ (S84 kararı). */}
      <LeaveStagedConfirmDialog
        open={leaveConfirmOpen}
        onOpenChange={setLeaveConfirmOpen}
        onConfirm={() => {
          setLeaveConfirmOpen(false);
          leaveScreen();
        }}
      />

      <OrderNoteModal
        open={noteModalOpen}
        onOpenChange={setNoteModalOpen}
        initialNote={persistedQuery.data?.order.note ?? null}
        isSaving={updateOrderNote.isPending}
        onSave={(note) => {
          if (persistedOrderId === null) return;
          updateOrderNote.mutate(
            { orderId: persistedOrderId, note },
            {
              onSuccess: () => {
                setNoteModalOpen(false);
                toast.success(t('order.adisyon.noteModal.saveSuccess'));
              },
              onError: () => {
                toast.error(t('order.adisyon.noteModal.saveError'));
              },
            },
          );
        }}
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
        initialPhone={callPhone ?? activeCustomer?.primaryPhone ?? null}
        selectedCustomer={activeCustomer}
        onPick={async (customer) => {
          setCustomerPickerOpen(false);
          // Aynı müşteri yeniden seçildiyse sunucuya gitme (gereksiz PATCH +
          // audit kaydı üretmez).
          if (customer.id === activeCustomer?.id) return;
          // Kaydedilmiş sipariş (dine_in VEYA takeaway-edit): PATCH
          // /orders/:id/customer (Session 53). S105 [USER]: paket siparişte de
          // müşteri değiştirilebilir — yanlış müşteriye açılmış paketi
          // düzeltmenin tek yolu buydu. Backend takeaway'de yalnız null'a
          // düşürmeyi reddeder, değiştirmeye izin verir.
          if (persistedOrderId !== null) {
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
          BAŞARIDA board'a dön: bu ekran kaynak masayı gösteriyordu, taşındıktan
          sonra burada kalmak anlamsız. YARIŞ-KAYBINDA (hedef doldu) picker'da
          kal (task_47cd76cb) — toast "başka masa seç" ile uyumlu. */}
      <MoveTableModal
        open={moveOpen}
        onOpenChange={setMoveOpen}
        sourceLabel={tableLabel}
        orderId={persistedOrderId}
        sourceTableId={table?.id ?? null}
        allTables={tablesQuery.data ?? []}
        areas={areasQuery.data ?? []}
        onMoved={(reason) => {
          void queryClient.invalidateQueries({ queryKey: ['tables'] });
          if (reason === 'moved') navigate('/tables');
        }}
      />

      {/* ADR-029 "Adisyon Aktar" — aktif dine_in siparişini başka DOLU masaya
          birleştir. BAŞARIDA board'a dön (kaynak masa boşaldı, burada kalmak
          anlamsız). YARIŞ-KAYBINDA (hedef boşaldı) picker'da kal (onMerged
          'occupied', #244 ikizi) — toast "başka masa seç" ile uyumlu. */}
      <MergeTableModal
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        sourceLabel={tableLabel}
        sourceOrderId={persistedOrderId}
        sourceTableId={table?.id ?? null}
        allTables={tablesQuery.data ?? []}
        areas={areasQuery.data ?? []}
        onMerged={(reason) => {
          void queryClient.invalidateQueries({ queryKey: ['tables'] });
          if (reason === 'merged') navigate('/tables');
        }}
      />

      {/* ADR-035 "Ürünü Başka Masaya Taşı" — TEK kalemi hedef masanın
          adisyonuna aktarır (hedef boşsa sunucu yeni adisyon açar, S3).
          BAŞARIDA ekranda KALINIR: yalnız bir kalem gitti, kullanıcı bu masayla
          işine devam edebilir (ADR-028/029'da siparişin TAMAMI gittiği için
          board'a dönülür — buradaki fark bilinçli). Kaynak adisyonun son kalemi
          taşındıysa masa boşalır ve ekran boş adisyona düşer; invalidate bunu
          zaten yansıtır. */}
      <MoveItemToTableModal
        open={moveItemTargetId !== null}
        onOpenChange={(open) => !open && setMoveItemTargetId(null)}
        item={moveItemTarget}
        sourceOrderId={persistedOrderId}
        sourceTableId={table?.id ?? null}
        sourceLabel={tableLabel}
        allTables={tablesQuery.data ?? []}
        areas={areasQuery.data ?? []}
        onMoved={() => {
          // Hem başarıda hem yarış-kaybında board tazelenir (hook başarıda
          // zaten invalidate eder; 'stale' yolunda picker gerçeği görsün diye
          // burada da yapılır — MoveTableModal parent deseni).
          void queryClient.invalidateQueries({ queryKey: ['tables'] });
        }}
      />

      <OrderProductDetailModal
        product={modalProduct}
        initial={modalInitial}
        onClose={handleModalClose}
        onConfirm={handleModalConfirm}
      />
    </div>
  );
}
