import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useTables, useAreas } from '../tables/api';
import type { ApiProduct } from '../admin/menu-products/api';
import { OrderScreenHeader } from './components/OrderScreenHeader';
import { AdisyonPanel } from './components/AdisyonPanel';
import { ProductCatalog } from './components/ProductCatalog';
import { useCart } from './useCart';

/**
 * Masa Detay / Sipariş Alma — ADR-013 (Phase 2).
 *
 * PR-1 SHELL — yalnız iskelet. Ürün katalogu, sepet, ödeme akışları
 * sonraki PR'larda (PR-2…PR-12).
 *
 * 3-pane layout (ADR-013 §4):
 *   - Üst: OrderScreenHeader
 *   - Orta sol: ProductCatalog (PR-2'de gelir; şimdi placeholder)
 *   - Orta sağ: AdisyonPanel (boş state)
 *   - Alt: BottomActionBar (₺0,00, action yok)
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

  const handleBack = () => navigate('/tables');
  // Placeholder handlers — sonraki PR'larda gerçek davranış (PR-7/8/9/10).
  const handleCustomer = () => undefined;
  const handlePrint = () => undefined;
  const handleTransferTable = () => undefined;

  // ProductCard tıklama → cart.addItem (qty=0'dan 1'e veya qty++).
  const handleSelectProduct = (product: ApiProduct) => cart.addItem(product);

  // ProductCard stepper overlay − butonu — PR-3'te rowId = productId.
  // PR-6'da (varyant/attribute) rowId composite olur, decrement target ayrı modal'dan.
  const handleDecrementProduct = (product: ApiProduct) =>
    cart.decrementItem(product.id);

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

  // PR-3: pending kalemler useCart'tan; persisted PR-5'te eklenecek.
  // KDV/indirim Phase 3 hesaplaması yok — total = subtotal MVP'de.
  const persistedItemCount = 0;
  const subtotalCents = cart.subtotalCents;
  const totalCents = subtotalCents;
  const hint = cart.isDirty ? t('order.adisyon.saveHint') : null;

  return (
    <div
      className="grid h-screen w-full grid-cols-[7fr_3fr] bg-stone-50"
      style={{ borderBottom: '3px solid var(--v3-purple, #7c3aed)' }}
    >
      {/* Sol sütun: header + catalog (kendi içinde dikey stack).
          v3 paritesi: header sadece sol tarafı kapsar, sağ adisyon panel
          page'in en üstünden başlar. */}
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

      {/* Sağ sütun: AdisyonPanel full-height, page'in en üstünden başlar. */}
      <AdisyonPanel
        persistedItemCount={persistedItemCount}
        pendingItems={cart.items}
        subtotalCents={subtotalCents}
        totalCents={totalCents}
        hint={hint}
        onPendingIncrement={cart.incrementItem}
        onPendingDecrement={cart.decrementItem}
        onPendingRemove={cart.removeItem}
        onTransferTable={handleTransferTable}
        onClose={handleBack}
      />
    </div>
  );
}
