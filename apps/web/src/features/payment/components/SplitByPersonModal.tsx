import { useMemo, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Banknote,
  Check,
  CreditCard,
  Loader2,
  Plus,
  RotateCcw,
  Undo2,
  UserPlus,
  X,
} from 'lucide-react';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import { formatMoney } from '@restoran-pos/shared-domain';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog';
import type { ApiOrderItem } from '../../orders/api';
import {
  useCreatePayment,
  type ApiPayment,
  type PaymentType,
} from '../api';

/**
 * SplitByPersonModal — ADR-014 §5 + §9 Karar 9.7 (v3 SplitPaymentModal paritesi).
 *
 * Layout (v3 ekran 4):
 *   - Header: "Ayrı Ayrı Öde" + "M{N} · Ürünleri kişilere paylaştırın"
 *   - 3 sayaç (KALAN YOK — Karar 9.2): Sipariş Toplamı + Ödenen + Dağıtımda
 *   - Sol: KALAN ÜRÜNLER (kalan qty + `+` buton)
 *   - Sağ: Active payer + 3 üst buton (Geri Al / Bölmeyi Sıfırla / Kişi Ekle)
 *
 * State (useReducer):
 *   payers: { id, no, label, items: { [orderItemId]: qty }, paymentType }[]
 *   history: state snapshot stack (undo)
 *   activePayerId
 *
 * Aksiyonlar:
 *   ADD_ITEM, REMOVE_ITEM, ADD_PAYER, REMOVE_PAYER, SET_PAYMENT_TYPE,
 *   SET_ACTIVE, UNDO, RESET, COMMIT_PAYER (server response sonrası temizlik)
 */

interface SplitByPersonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableCode: string;
  orderId: string | null;
  orderItems: ApiOrderItem[];
  orderTotalCents: number;
  /** Ödenmiş payments (Ödenen sayacı için). */
  existingPayments: ApiPayment[];
  /** Bir payer ödeme aldı — parent paymentsQuery invalidate edebilir. */
  onPayerCommitted?: () => void;
}

interface Payer {
  id: string;
  no: number;
  label: string;
  items: Record<string, number>;
  paymentType: PaymentType;
}

interface SplitState {
  payers: Payer[];
  activePayerId: string;
  history: Array<{ payers: Payer[]; activePayerId: string }>;
}

type SplitAction =
  | { type: 'ADD_ITEM'; payerId: string; orderItemId: string }
  | { type: 'REMOVE_ITEM'; payerId: string; orderItemId: string }
  | { type: 'ADD_PAYER' }
  | { type: 'REMOVE_PAYER'; payerId: string }
  | { type: 'SET_PAYMENT_TYPE'; payerId: string; paymentType: PaymentType }
  | { type: 'SET_ACTIVE'; payerId: string }
  | { type: 'UNDO' }
  | { type: 'RESET' }
  | { type: 'COMMIT_PAYER'; payerId: string };

function makePayer(no: number): Payer {
  return {
    id: `p${no}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    no,
    label: `Kişi ${no}`,
    items: {},
    paymentType: 'cash',
  };
}

function snapshot(state: SplitState): {
  payers: Payer[];
  activePayerId: string;
} {
  return {
    payers: state.payers.map((p) => ({ ...p, items: { ...p.items } })),
    activePayerId: state.activePayerId,
  };
}

function withHistory(
  state: SplitState,
  next: Partial<SplitState>,
): SplitState {
  return {
    ...state,
    ...next,
    history: [...state.history, snapshot(state)],
  };
}

function reducer(state: SplitState, action: SplitAction): SplitState {
  switch (action.type) {
    case 'ADD_ITEM': {
      const next = state.payers.map((p) =>
        p.id === action.payerId
          ? {
              ...p,
              items: {
                ...p.items,
                [action.orderItemId]: (p.items[action.orderItemId] ?? 0) + 1,
              },
            }
          : p,
      );
      return withHistory(state, { payers: next });
    }
    case 'REMOVE_ITEM': {
      const next = state.payers.map((p) => {
        if (p.id !== action.payerId) return p;
        const cur = p.items[action.orderItemId] ?? 0;
        if (cur <= 1) {
          const items = { ...p.items };
          delete items[action.orderItemId];
          return { ...p, items };
        }
        return { ...p, items: { ...p.items, [action.orderItemId]: cur - 1 } };
      });
      return withHistory(state, { payers: next });
    }
    case 'ADD_PAYER': {
      const maxNo = state.payers.reduce((m, p) => Math.max(m, p.no), 0);
      const newPayer = makePayer(maxNo + 1);
      return withHistory(state, {
        payers: [...state.payers, newPayer],
        activePayerId: newPayer.id,
      });
    }
    case 'REMOVE_PAYER': {
      if (state.payers.length <= 1) return state;
      const next = state.payers.filter((p) => p.id !== action.payerId);
      const active =
        state.activePayerId === action.payerId
          ? next[0]?.id ?? ''
          : state.activePayerId;
      return withHistory(state, { payers: next, activePayerId: active });
    }
    case 'SET_PAYMENT_TYPE': {
      const next = state.payers.map((p) =>
        p.id === action.payerId ? { ...p, paymentType: action.paymentType } : p,
      );
      // History'ye eklemiyoruz; tip değişikliği undo için anlamlı değil
      return { ...state, payers: next };
    }
    case 'SET_ACTIVE': {
      return { ...state, activePayerId: action.payerId };
    }
    case 'UNDO': {
      const last = state.history[state.history.length - 1];
      if (last === undefined) return state;
      return {
        ...state,
        payers: last.payers,
        activePayerId: last.activePayerId,
        history: state.history.slice(0, -1),
      };
    }
    case 'RESET': {
      const fresh = makePayer(1);
      return {
        payers: [fresh],
        activePayerId: fresh.id,
        history: [],
      };
    }
    case 'COMMIT_PAYER': {
      // Ödeme alındı: payer'ı listeden çıkar; tek payer kaldıysa fresh state
      const remaining = state.payers.filter((p) => p.id !== action.payerId);
      if (remaining.length === 0) {
        const fresh = makePayer(1);
        return {
          payers: [fresh],
          activePayerId: fresh.id,
          history: [],
        };
      }
      return {
        ...state,
        payers: remaining,
        activePayerId: remaining[0]!.id,
        // History saklayıp undo'da geri ekleme yapılmaz (commit irreversible)
        history: [],
      };
    }
    default:
      return state;
  }
}

const initialPayer = makePayer(1);
const initialState: SplitState = {
  payers: [initialPayer],
  activePayerId: initialPayer.id,
  history: [],
};

export function SplitByPersonModal({
  open,
  onOpenChange,
  tableCode,
  orderId,
  orderItems,
  orderTotalCents,
  existingPayments,
  onPayerCommitted,
}: SplitByPersonModalProps) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [processingPayerId, setProcessingPayerId] = useState<string | null>(
    null,
  );

  const activePayer = useMemo(
    () =>
      state.payers.find((p) => p.id === state.activePayerId) ?? state.payers[0]!,
    [state.payers, state.activePayerId],
  );

  // Cancelled/comped kalemler split akışından dışlanır.
  const eligibleItems = useMemo(
    () => orderItems.filter((it) => it.status !== 'cancelled' && !it.is_comped),
    [orderItems],
  );

  // Kaç kalem zaten payments'a bağlı? GET /payments orderId'ye sahip ama
  // payment_items detay yok; pragmatik: sadece toplam tutar üzerinden Ödenen
  // hesaplıyoruz. İkinci kez ödemeye çalışılan kalem 409 PAYMENT_QTY_EXCEEDS
  // alacak — server otoritesi.
  const paidCents = useMemo(
    () => existingPayments.reduce((sum, p) => sum + p.amount_cents, 0),
    [existingPayments],
  );

  // Dağıtımda — tüm payer'ların draft total'ı
  const draftCents = useMemo(() => {
    let total = 0;
    for (const p of state.payers) {
      for (const [itemId, qty] of Object.entries(p.items)) {
        const oi = eligibleItems.find((it) => it.id === itemId);
        if (oi !== undefined) total += oi.unit_price_cents * qty;
      }
    }
    return total;
  }, [state.payers, eligibleItems]);

  // Her order_item için kalan qty (toplam dağıtılmamış)
  const remainingItemQty = useMemo(() => {
    const allocated = new Map<string, number>();
    for (const p of state.payers) {
      for (const [itemId, qty] of Object.entries(p.items)) {
        allocated.set(itemId, (allocated.get(itemId) ?? 0) + qty);
      }
    }
    const result = new Map<string, number>();
    for (const it of eligibleItems) {
      result.set(it.id, it.quantity - (allocated.get(it.id) ?? 0));
    }
    return result;
  }, [eligibleItems, state.payers]);

  const activePayerTotal = useMemo(() => {
    let total = 0;
    for (const [itemId, qty] of Object.entries(activePayer.items)) {
      const oi = eligibleItems.find((it) => it.id === itemId);
      if (oi !== undefined) total += oi.unit_price_cents * qty;
    }
    return total;
  }, [activePayer, eligibleItems]);

  const createPayment = useCreatePayment();

  const handleCommitPayer = async () => {
    if (orderId === null) return;
    const allocations = Object.entries(activePayer.items)
      .filter(([, qty]) => qty > 0)
      .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
    if (allocations.length === 0) {
      toast.info(t('payment.split.noItemsForPayer'));
      return;
    }
    setProcessingPayerId(activePayer.id);
    try {
      const result = await createPayment.mutateAsync({
        orderId,
        paymentType: activePayer.paymentType,
        paymentScope: 'item',
        amountCents: activePayerTotal,
        idempotencyKey: crypto.randomUUID(),
        operation: 'pay',
        itemAllocations: allocations,
      });
      toast.success(
        result.replay
          ? t('payment.replayDetected')
          : t('payment.split.payerCommitted', { label: activePayer.label }),
      );
      onPayerCommitted?.();
      dispatch({ type: 'COMMIT_PAYER', payerId: activePayer.id });
    } catch (err) {
      const code = isAxiosError(err)
        ? (err.response?.data as { error?: { code?: string } } | undefined)
            ?.error?.code
        : null;
      const localized = code
        ? t(`payment.errors.${code}`, { defaultValue: '' })
        : '';
      toast.error(
        localized !== '' ? localized : t('payment.split.commitError'),
      );
    } finally {
      setProcessingPayerId(null);
    }
  };

  const isProcessing = processingPayerId !== null;

  return (
    <Dialog open={open} onOpenChange={(v) => !isProcessing && onOpenChange(v)}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t('payment.split.title')}</DialogTitle>
          <DialogDescription>
            {t('payment.split.subtitle', { code: tableCode })}
          </DialogDescription>
        </DialogHeader>

        {/* 3 sayaç (KALAN YOK — Karar 9.2) */}
        <div className="mb-3 grid grid-cols-3 gap-3">
          <CounterCard
            label={t('payment.summary.orderTotal')}
            value={formatMoney(orderTotalCents)}
          />
          <CounterCard
            label={t('payment.summary.paid')}
            value={formatMoney(paidCents)}
            color="success"
          />
          <CounterCard
            label={t('payment.split.draft')}
            value={formatMoney(draftCents)}
            color="purple"
          />
        </div>

        {/* 2-pane */}
        <div className="grid grid-cols-2 gap-4">
          {/* Sol — Kalan Ürünler */}
          <div
            className="rounded-xl p-4"
            style={{
              background: 'var(--v3-surface-2, #F1F5FB)',
              border: '1px solid var(--v3-border-subtle)',
            }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span
                className="text-[11px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {t('payment.split.remainingItemsTitle')}
              </span>
              <span
                className="text-[11px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {t('payment.split.addToPayer', { label: activePayer.label })}
              </span>
            </div>
            <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
              {eligibleItems.map((it) => {
                const remaining = remainingItemQty.get(it.id) ?? 0;
                if (remaining <= 0) return null;
                return (
                  <div
                    key={it.id}
                    className="flex items-center gap-3 rounded-lg p-3"
                    style={{ background: '#fff' }}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate text-[13px] font-bold uppercase"
                        style={{ color: 'var(--v3-text-primary)' }}
                      >
                        {remaining}× {it.product_name}
                      </div>
                      <div
                        className="text-[11px]"
                        style={{ color: 'var(--v3-text-muted)' }}
                      >
                        {formatMoney(it.unit_price_cents * remaining)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: 'ADD_ITEM',
                          payerId: activePayer.id,
                          orderItemId: it.id,
                        })
                      }
                      disabled={isProcessing}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white transition-colors disabled:opacity-50"
                      style={{ background: 'var(--v3-purple, #7C5CFA)' }}
                      aria-label={t('payment.split.addOne')}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                );
              })}
              {[...remainingItemQty.values()].every((q) => q <= 0) && (
                <div
                  className="rounded-md border border-dashed p-6 text-center text-sm"
                  style={{
                    borderColor: 'var(--v3-border-subtle)',
                    color: 'var(--v3-text-muted)',
                  }}
                >
                  {t('payment.split.allDistributed')}
                </div>
              )}
            </div>
          </div>

          {/* Sağ — Payerlar */}
          <div className="flex flex-col gap-3">
            {/* Üst butonlar */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => dispatch({ type: 'UNDO' })}
                disabled={state.history.length === 0 || isProcessing}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-white px-3 text-[12px] font-semibold disabled:opacity-50"
                style={{ borderColor: 'var(--v3-border-subtle)' }}
              >
                <Undo2 size={14} />
                {t('payment.split.undo')}
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: 'RESET' })}
                disabled={isProcessing}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-white px-3 text-[12px] font-semibold disabled:opacity-50"
                style={{ borderColor: 'var(--v3-border-subtle)' }}
              >
                <RotateCcw size={14} />
                {t('payment.split.reset')}
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: 'ADD_PAYER' })}
                disabled={isProcessing}
                className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[12px] font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--v3-purple, #7C5CFA)' }}
              >
                <UserPlus size={14} />
                {t('payment.split.addPayer')}
              </button>
            </div>

            {/* Payer listesi (her biri ayrı kart) */}
            <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
              {state.payers.map((payer) => {
                const isActive = payer.id === activePayer.id;
                const total = Object.entries(payer.items).reduce(
                  (sum, [itemId, qty]) => {
                    const oi = eligibleItems.find((it) => it.id === itemId);
                    return sum + (oi?.unit_price_cents ?? 0) * qty;
                  },
                  0,
                );
                return (
                  <button
                    key={payer.id}
                    type="button"
                    onClick={() =>
                      dispatch({ type: 'SET_ACTIVE', payerId: payer.id })
                    }
                    className="rounded-xl p-4 text-left transition-colors"
                    style={{
                      background: '#fff',
                      border: `2px solid ${isActive ? 'var(--v3-purple, #7C5CFA)' : 'var(--v3-border-subtle)'}`,
                    }}
                  >
                    {/* Payer header */}
                    <div className="mb-2 flex items-center justify-between">
                      <span
                        className="text-[14px] font-bold"
                        style={{ color: 'var(--v3-text-primary)' }}
                      >
                        {payer.label}
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className="text-[14px] font-extrabold tabular-nums"
                          style={{ color: 'var(--v3-text-primary)' }}
                        >
                          {formatMoney(total)}
                        </span>
                        {state.payers.length > 1 && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              dispatch({
                                type: 'REMOVE_PAYER',
                                payerId: payer.id,
                              });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.stopPropagation();
                                dispatch({
                                  type: 'REMOVE_PAYER',
                                  payerId: payer.id,
                                });
                              }
                            }}
                            aria-label={t('payment.split.removePayer')}
                            className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-red-500"
                          >
                            <X size={14} />
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Allocated items */}
                    {Object.keys(payer.items).length === 0 ? (
                      <div
                        className="rounded-md border border-dashed p-3 text-center text-[12px]"
                        style={{
                          borderColor: 'var(--v3-border-subtle)',
                          color: 'var(--v3-text-muted)',
                        }}
                      >
                        {t('payment.split.emptyPayer')}
                      </div>
                    ) : (
                      <div className="mb-2 flex flex-col gap-1">
                        {Object.entries(payer.items).map(([itemId, qty]) => {
                          const oi = eligibleItems.find((it) => it.id === itemId);
                          if (oi === undefined || qty <= 0) return null;
                          return (
                            <div
                              key={itemId}
                              className="flex items-center justify-between rounded-md px-2 py-1 text-[12px]"
                              style={{
                                background: 'var(--v3-surface-2, #F1F5FB)',
                              }}
                            >
                              <span style={{ color: 'var(--v3-text-primary)' }}>
                                {qty}× {oi.product_name}
                              </span>
                              <div className="flex items-center gap-2">
                                <span
                                  className="tabular-nums"
                                  style={{ color: 'var(--v3-text-secondary)' }}
                                >
                                  {formatMoney(oi.unit_price_cents * qty)}
                                </span>
                                {isActive && (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      dispatch({
                                        type: 'REMOVE_ITEM',
                                        payerId: payer.id,
                                        orderItemId: itemId,
                                      });
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.stopPropagation();
                                        dispatch({
                                          type: 'REMOVE_ITEM',
                                          payerId: payer.id,
                                          orderItemId: itemId,
                                        });
                                      }
                                    }}
                                    className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded text-red-500"
                                    aria-label={t('payment.split.removeOne')}
                                  >
                                    <X size={12} />
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Active: Nakit/Kart + Bu kişiden öde */}
                    {isActive && (
                      <div className="mt-2 flex flex-col gap-2">
                        <div className="grid grid-cols-2 gap-2">
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              dispatch({
                                type: 'SET_PAYMENT_TYPE',
                                payerId: payer.id,
                                paymentType: 'cash',
                              });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.stopPropagation();
                                dispatch({
                                  type: 'SET_PAYMENT_TYPE',
                                  payerId: payer.id,
                                  paymentType: 'cash',
                                });
                              }
                            }}
                            className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md text-[12px] font-bold"
                            style={{
                              background:
                                payer.paymentType === 'cash'
                                  ? 'var(--v3-purple, #7C5CFA)'
                                  : '#fff',
                              color:
                                payer.paymentType === 'cash'
                                  ? '#fff'
                                  : 'var(--v3-text-primary)',
                              border:
                                payer.paymentType === 'cash'
                                  ? 'none'
                                  : '1px solid var(--v3-border-subtle)',
                            }}
                          >
                            <Banknote size={14} /> {t('payment.type.cash')}
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              dispatch({
                                type: 'SET_PAYMENT_TYPE',
                                payerId: payer.id,
                                paymentType: 'card',
                              });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.stopPropagation();
                                dispatch({
                                  type: 'SET_PAYMENT_TYPE',
                                  payerId: payer.id,
                                  paymentType: 'card',
                                });
                              }
                            }}
                            className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md text-[12px] font-bold"
                            style={{
                              background:
                                payer.paymentType === 'card'
                                  ? 'var(--v3-purple, #7C5CFA)'
                                  : '#fff',
                              color:
                                payer.paymentType === 'card'
                                  ? '#fff'
                                  : 'var(--v3-text-primary)',
                              border:
                                payer.paymentType === 'card'
                                  ? 'none'
                                  : '1px solid var(--v3-border-subtle)',
                            }}
                          >
                            <CreditCard size={14} /> {t('payment.type.card')}
                          </span>
                        </div>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCommitPayer();
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.stopPropagation();
                              void handleCommitPayer();
                            }
                          }}
                          aria-disabled={isProcessing || total <= 0}
                          className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md text-[13px] font-bold text-white"
                          style={{
                            background: 'var(--v3-success, #1F9D68)',
                            opacity: isProcessing || total <= 0 ? 0.5 : 1,
                            cursor:
                              isProcessing || total <= 0
                                ? 'not-allowed'
                                : 'pointer',
                          }}
                        >
                          {processingPayerId === payer.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Check size={14} />
                          )}
                          {t('payment.split.commitPayer')}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CounterCard({
  label,
  value,
  color = 'neutral',
}: {
  label: string;
  value: string;
  color?: 'neutral' | 'success' | 'purple';
}) {
  const valueColor =
    color === 'success'
      ? 'var(--v3-success, #1F9D68)'
      : color === 'purple'
        ? 'var(--v3-purple, #7C5CFA)'
        : 'var(--v3-text-primary)';
  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: '#fff',
        border: '1px solid var(--v3-border-subtle)',
      }}
    >
      <div
        className="mb-0.5 text-[10px] font-bold uppercase tracking-wider"
        style={{ color: 'var(--v3-text-muted)' }}
      >
        {label}
      </div>
      <div
        className="text-[18px] font-extrabold tabular-nums"
        style={{ color: valueColor }}
      >
        {value}
      </div>
    </div>
  );
}
