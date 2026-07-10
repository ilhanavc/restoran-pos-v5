import { useEffect, useMemo, useReducer, useState } from 'react';
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
} from '../../../components/ui/dialog';
import { useAuthStore } from '../../../store/auth';
import {
  useCreatePayment,
  usePaymentsForOrder,
  useSplitState,
  type ApiPayment,
  type PaymentType,
  type SplitStateAllocation,
  type SplitStateItem,
} from '../api';
import { VoidPaymentDialog } from './VoidPaymentDialog';

/**
 * SplitPaymentModal — v3 `client/src/components/payments/SplitPaymentModal.jsx`
 * görsel + davranış birebir paritesi (ADR-014 §10 Karar 10.7).
 *
 * Layout:
 *   - modal-md (max-w 720px), max-h 92vh
 *   - Header: "Ayrı Ayrı Öde" + subtitle "Masa N · Ürünleri kişilere paylaştırın"
 *   - 4-sayaç bar: Sipariş Toplamı / Ödenen / Kalan / Dağıtımda
 *   - has_unallocated_payments banner (kırmızı tonlu)
 *   - Body 2-pane:
 *     * Sol: Kalan ürünler (qty + ad + remaining + birim/total + `+` buton)
 *     * Sağ: toolbar (Geri Al / Bölmeyi Sıfırla / Kişi Ekle) + paid groups +
 *       draft payer kartları (Nakit/Kart + cashReceived/Tam/Para üstü +
 *       Bu kişiden ödemeyi al yeşil buton)
 *
 * State: useReducer (payers, history max 24, activePayerId).
 */

interface SplitPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableCode: string;
  orderId: string | null;
  onPayerCommitted?: () => void;
}

interface Payer {
  id: string;
  no: number;
  label: string;
  items: Record<string, number>;
  paymentType: PaymentType;
  cashReceivedInput: string; // string for empty/decimal control
}

interface SplitState {
  payers: Payer[];
  activePayerId: string;
  history: Array<{ payers: Payer[]; activePayerId: string }>;
}

type Action =
  | { type: 'ADD_ITEM'; payerId: string; orderItemId: string }
  | { type: 'REMOVE_ITEM'; payerId: string; orderItemId: string }
  | { type: 'ADD_PAYER' }
  | { type: 'REMOVE_PAYER'; payerId: string }
  | { type: 'SET_ACTIVE'; payerId: string }
  | { type: 'SET_PAYMENT_TYPE'; payerId: string; paymentType: PaymentType }
  | { type: 'SET_CASH_RECEIVED'; payerId: string; value: string }
  | { type: 'UNDO' }
  | { type: 'RESET'; nextNo?: number }
  | { type: 'COMMIT_PAYER'; payerId: string; nextNo: number };

function makePayer(no: number): Payer {
  return {
    id: `p${no}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    no,
    label: `Kişi ${no}`,
    items: {},
    paymentType: 'cash',
    cashReceivedInput: '',
  };
}

function snapshot(state: SplitState): {
  payers: Payer[];
  activePayerId: string;
} {
  return {
    payers: JSON.parse(JSON.stringify(state.payers)) as Payer[],
    activePayerId: state.activePayerId,
  };
}

function pushHistory(state: SplitState): SplitState['history'] {
  return [...state.history.slice(-23), snapshot(state)];
}

function reducer(state: SplitState, action: Action): SplitState {
  switch (action.type) {
    case 'ADD_ITEM': {
      const history = pushHistory(state);
      const payers = state.payers.map((p) =>
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
      return { ...state, payers, history };
    }
    case 'REMOVE_ITEM': {
      const history = pushHistory(state);
      const payers = state.payers.map((p) => {
        if (p.id !== action.payerId) return p;
        const cur = p.items[action.orderItemId] ?? 0;
        if (cur <= 1) {
          const items = { ...p.items };
          delete items[action.orderItemId];
          return { ...p, items };
        }
        return { ...p, items: { ...p.items, [action.orderItemId]: cur - 1 } };
      });
      return { ...state, payers, history };
    }
    case 'ADD_PAYER': {
      const history = pushHistory(state);
      const maxNo = state.payers.reduce((m, p) => Math.max(m, p.no), 0);
      const np = makePayer(maxNo + 1);
      return {
        payers: [...state.payers, np],
        activePayerId: np.id,
        history,
      };
    }
    case 'REMOVE_PAYER': {
      if (state.payers.length <= 1) return state;
      const history = pushHistory(state);
      const payers = state.payers.filter((p) => p.id !== action.payerId);
      const activePayerId =
        state.activePayerId === action.payerId
          ? payers[0]!.id
          : state.activePayerId;
      return { payers, activePayerId, history };
    }
    case 'SET_ACTIVE':
      return { ...state, activePayerId: action.payerId };
    case 'SET_PAYMENT_TYPE': {
      const payers = state.payers.map((p) =>
        p.id === action.payerId ? { ...p, paymentType: action.paymentType } : p,
      );
      return { ...state, payers };
    }
    case 'SET_CASH_RECEIVED': {
      const payers = state.payers.map((p) =>
        p.id === action.payerId ? { ...p, cashReceivedInput: action.value } : p,
      );
      return { ...state, payers };
    }
    case 'UNDO': {
      const last = state.history[state.history.length - 1];
      if (last === undefined) return state;
      return {
        payers: last.payers,
        activePayerId: last.activePayerId,
        history: state.history.slice(0, -1),
      };
    }
    case 'RESET': {
      const fresh = makePayer(action.nextNo ?? 1);
      return { payers: [fresh], activePayerId: fresh.id, history: [] };
    }
    case 'COMMIT_PAYER': {
      // v3 paritesi: commit sonrası history reset (irreversible).
      const remaining = state.payers.filter((p) => p.id !== action.payerId);
      if (remaining.length === 0) {
        const fresh = makePayer(action.nextNo);
        return { payers: [fresh], activePayerId: fresh.id, history: [] };
      }
      return {
        payers: remaining,
        activePayerId: remaining[0]!.id,
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

export function SplitPaymentModal({
  open,
  onOpenChange,
  tableCode,
  orderId,
  onPayerCommitted,
}: SplitPaymentModalProps) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [processingPayerId, setProcessingPayerId] = useState<string | null>(
    null,
  );

  const splitStateQuery = useSplitState(orderId);
  const splitData = splitStateQuery.data;

  // ADR-033 K7b — ödeme satırı "Geri Al". RBAC admin+cashier (K6; waiter
  // butonu görmez, backend zaten 403 döner). Voided satırlar split-state
  // allocations'tan DÜŞER (aritmetik) — üstü-çizili gösterim GET /payments'tan.
  const role = useAuthStore((s) => s.user?.role);
  const canVoid = role === 'admin' || role === 'cashier';
  const [voidPaymentId, setVoidPaymentId] = useState<string | null>(null);
  const orderPaymentsQuery = usePaymentsForOrder(open ? orderId : null);
  const voidedPayments = useMemo(
    () => (orderPaymentsQuery.data ?? []).filter((p) => p.voided_at !== null),
    [orderPaymentsQuery.data],
  );

  // Modal her açılışta YALNIZ BİR KEZ reset (open=true geçişinde).
  // splitData dependency'si KALDIRILDI — server-side allocations refetch olduğunda
  // (örn 'Bu kişiden ödemeyi al' commit sonrası) draft state'i override etmesin.
  // Manuel "Bölmeyi Sıfırla" butonu da kullanıcı eylemi olarak çalışsın.
  useEffect(() => {
    if (!open) return;
    const maxPayerNo = (splitStateQuery.data?.allocations ?? [])
      .map((a) => a.payer_no ?? 0)
      .reduce((m, n) => Math.max(m, n), 0);
    dispatch({ type: 'RESET', nextNo: maxPayerNo + 1 });
  }, [open]); // intentional: yalnızca modal açılış geçişinde reset

  const items = splitData?.items ?? [];
  const allocations = splitData?.allocations ?? [];
  const totals = splitData?.totals ?? {
    order_total_cents: 0,
    paid_total_cents: 0,
    remaining_total_cents: 0,
    has_unallocated_payments: false,
  };

  const itemMap = useMemo(
    () => new Map(items.map((it) => [it.id, it])),
    [items],
  );

  // Kalan qty per item — server remaining_quantity'den draft düş
  const draftQtyByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of state.payers) {
      for (const [itemId, qty] of Object.entries(p.items)) {
        m.set(itemId, (m.get(itemId) ?? 0) + qty);
      }
    }
    return m;
  }, [state.payers]);

  const draftTotalCents = useMemo(() => {
    let total = 0;
    for (const p of state.payers) {
      for (const [itemId, qty] of Object.entries(p.items)) {
        const oi = itemMap.get(itemId);
        if (oi !== undefined) total += oi.unit_price_cents * qty;
      }
    }
    return total;
  }, [state.payers, itemMap]);

  const activePayer =
    state.payers.find((p) => p.id === state.activePayerId) ?? state.payers[0]!;

  const activePayerTotal = useMemo(() => {
    let total = 0;
    for (const [itemId, qty] of Object.entries(activePayer.items)) {
      const oi = itemMap.get(itemId);
      if (oi !== undefined) total += oi.unit_price_cents * qty;
    }
    return total;
  }, [activePayer, itemMap]);

  // Cash received & change calc (v3 paritesi)
  const cashReceivedCents = useMemo(() => {
    const raw = activePayer.cashReceivedInput.trim().replace(',', '.');
    if (raw === '') return activePayerTotal; // boşsa = total (varsayılan)
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.round(parsed * 100);
  }, [activePayer.cashReceivedInput, activePayerTotal]);

  const changeCents =
    activePayer.paymentType === 'cash'
      ? Math.max(0, cashReceivedCents - activePayerTotal)
      : 0;

  const createPayment = useCreatePayment();

  const handleCommitPayer = async () => {
    if (orderId === null || activePayerTotal <= 0) return;
    if (
      activePayer.paymentType === 'cash' &&
      cashReceivedCents + 2 < activePayerTotal // 2 cent tolerans (v3: 0.02)
    ) {
      toast.error(t('payment.split.cashReceivedTooLow'));
      return;
    }
    const allocations = Object.entries(activePayer.items)
      .filter(([, qty]) => qty > 0)
      .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
    if (allocations.length === 0) {
      toast.error(t('payment.split.noItemsForPayer'));
      return;
    }

    const maxPayerNo = (splitData?.allocations ?? [])
      .map((a) => a.payer_no ?? 0)
      .reduce((m, n) => Math.max(m, n), 0);

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
        ...(activePayer.paymentType === 'cash'
          ? { cashReceivedCents }
          : {}),
        payerNo: activePayer.no,
        payerLabel: activePayer.label,
      });
      toast.success(
        result.replay
          ? t('payment.replayDetected')
          : t('payment.split.payerCommitted', { label: activePayer.label }),
      );
      onPayerCommitted?.();
      void splitStateQuery.refetch();
      dispatch({
        type: 'COMMIT_PAYER',
        payerId: activePayer.id,
        nextNo: Math.max(activePayer.no + 1, maxPayerNo + 2),
      });
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
  const remainingTotal = totals.remaining_total_cents;
  const remainingTooLow = remainingTotal <= 2; // 2 cent tolerans

  return (
    <Dialog open={open} onOpenChange={(v) => !isProcessing && onOpenChange(v)}>
      <DialogContent
        overlayClassName="!bg-[rgba(17,35,63,0.18)]"
        className="flex flex-col gap-0 overflow-hidden p-0"
        style={{
          // v3 paritesi (SplitPaymentModal.jsx:496-497) — birebir ölçü
          width: 'min(1180px, 96vw)',
          maxWidth: 'min(1180px, 96vw)',
          height: 'min(820px, 94vh)',
          maxHeight: 'min(820px, 94vh)',
        }}
      >
        {/* Header (v3 modal-header) */}
        <div className="flex items-start justify-between border-b px-5 py-4" style={{ borderColor: 'var(--v3-border-subtle)' }}>
          <div>
            <h2 className="text-[18px] font-extrabold" style={{ color: 'var(--v3-text-primary)' }}>
              {t('payment.split.title')}
            </h2>
            <div className="mt-1 text-[12px]" style={{ color: 'var(--v3-text-muted)' }}>
              {t('payment.split.subtitle', { code: tableCode })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-stone-100 disabled:opacity-50"
            aria-label={t('payment.split.close')}
          >
            <X size={16} />
          </button>
        </div>

        {/* 4-sayaç bar (v3 split-payment-summary) — her sayaç ayrı kart içinde */}
        <div
          className="grid grid-cols-4 gap-3 border-b px-5 py-4"
          style={{
            background: 'var(--v3-bg-app, #F4F7FB)',
            borderColor: 'var(--v3-border-subtle)',
          }}
        >
          <CounterCell
            label={t('payment.summary.orderTotal')}
            value={formatMoney(totals.order_total_cents)}
          />
          <CounterCell
            label={t('payment.summary.paid')}
            value={formatMoney(totals.paid_total_cents)}
            color="success"
          />
          <CounterCell
            label={t('payment.split.remaining')}
            value={formatMoney(remainingTotal)}
            color={remainingTooLow ? 'success' : 'warning'}
          />
          <CounterCell
            label={t('payment.split.draft')}
            value={formatMoney(draftTotalCents)}
            color="purple"
          />
        </div>

        {/* has_unallocated_payments uyarı banner */}
        {totals.has_unallocated_payments && (
          <div
            className="border-b px-5 py-2 text-[12px]"
            style={{
              background: 'var(--v3-warning-soft, rgba(212, 136, 6, 0.14))',
              color: 'var(--v3-warning, #D48806)',
              borderColor: 'var(--v3-border-subtle)',
            }}
          >
            {t('payment.split.unallocatedWarning')}
          </div>
        )}

        {/* Body 2-pane */}
        <div className="grid flex-1 grid-cols-2 gap-0 overflow-hidden">
          {/* Sol — Kalan ürünler */}
          <section
            className="flex flex-col overflow-hidden border-r"
            style={{ borderColor: 'var(--v3-border-subtle)' }}
          >
            <div
              className="flex items-center justify-between border-b px-4 py-3"
              style={{ borderColor: 'var(--v3-border-subtle)' }}
            >
              <span className="text-[12px] font-bold" style={{ color: 'var(--v3-text-primary)' }}>
                {t('payment.split.remainingItemsTitle')}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--v3-text-muted)' }}>
                {t('payment.split.addToPayer', { label: activePayer.label })}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
              {items.map((it) => (
                <RemainingItemRow
                  key={it.id}
                  item={it}
                  draft={draftQtyByItem.get(it.id) ?? 0}
                  remainingTooLow={remainingTooLow}
                  onAdd={() =>
                    dispatch({
                      type: 'ADD_ITEM',
                      payerId: activePayer.id,
                      orderItemId: it.id,
                    })
                  }
                  disabled={isProcessing}
                />
              ))}
              {items.length === 0 && (
                <div
                  className="m-3 rounded-md border border-dashed p-6 text-center text-sm"
                  style={{
                    borderColor: 'var(--v3-border-subtle)',
                    color: 'var(--v3-text-muted)',
                  }}
                >
                  {t('payment.split.allDistributed')}
                </div>
              )}
            </div>
          </section>

          {/* Sağ — Payer paneli */}
          <section className="flex flex-col overflow-hidden">
            {/* Toolbar */}
            <div
              className="flex items-center gap-2 border-b px-4 py-2"
              style={{ borderColor: 'var(--v3-border-subtle)' }}
            >
              <button
                type="button"
                onClick={() => dispatch({ type: 'UNDO' })}
                disabled={state.history.length === 0 || isProcessing}
                className="inline-flex h-10 items-center gap-2 rounded-lg border bg-transparent px-4 text-[13px] font-semibold disabled:opacity-50 hover:bg-[var(--v3-surface-2,#F1F5FB)]"
                style={{ borderColor: 'var(--v3-border-subtle)', color: 'var(--v3-text-secondary)' }}
              >
                <Undo2 size={13} />
                {t('payment.split.undo')}
              </button>
              <button
                type="button"
                onClick={() => {
                  // ADR-014 §11 — manuel reset: server allocations'taki en yüksek
                  // payer_no + 1 ile yeni Kişi N olarak başla (v3 paritesi).
                  const maxPayerNo = allocations
                    .map((a) => a.payer_no ?? 0)
                    .reduce((m, n) => Math.max(m, n), 0);
                  dispatch({ type: 'RESET', nextNo: maxPayerNo + 1 });
                }}
                disabled={isProcessing}
                className="inline-flex h-10 items-center gap-2 rounded-lg border bg-transparent px-4 text-[13px] font-semibold disabled:opacity-50 hover:bg-[var(--v3-surface-2,#F1F5FB)]"
                style={{ borderColor: 'var(--v3-border-subtle)', color: 'var(--v3-text-secondary)' }}
              >
                <RotateCcw size={13} />
                {t('payment.split.reset')}
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: 'ADD_PAYER' })}
                disabled={isProcessing}
                className="ml-auto inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[13px] font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--v3-accent, #6C63FF)' }}
              >
                <UserPlus size={14} />
                {t('payment.split.addPayer')}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {/* Mevcut allocations (paid groups) */}
              {allocations.length > 0 && (
                <div className="mb-4 flex flex-col gap-2">
                  {allocations.map((g) => (
                    <PaidGroup
                      key={g.payment_id}
                      group={g}
                      itemMap={itemMap}
                      onVoid={
                        canVoid && !isProcessing
                          ? () => setVoidPaymentId(g.payment_id)
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}

              {/* Geri alınmış ödemeler — üstü çizili, silinmez (ADR-033 K7) */}
              {voidedPayments.length > 0 && (
                <div className="mb-4 flex flex-col gap-2">
                  {voidedPayments.map((p) => (
                    <VoidedPaymentCard key={p.id} payment={p} />
                  ))}
                </div>
              )}

              {/* Draft payerlar */}
              <div className="flex flex-col gap-2">
                {state.payers.map((payer) => (
                  <DraftPayerCard
                    key={payer.id}
                    payer={payer}
                    isActive={payer.id === activePayer.id}
                    canRemove={state.payers.length > 1}
                    isProcessing={processingPayerId === payer.id}
                    itemMap={itemMap}
                    cashReceivedCents={
                      payer.id === activePayer.id ? cashReceivedCents : null
                    }
                    changeCents={
                      payer.id === activePayer.id ? changeCents : 0
                    }
                    onSelect={() =>
                      dispatch({ type: 'SET_ACTIVE', payerId: payer.id })
                    }
                    onRemove={() =>
                      dispatch({ type: 'REMOVE_PAYER', payerId: payer.id })
                    }
                    onRemoveItem={(orderItemId) =>
                      dispatch({
                        type: 'REMOVE_ITEM',
                        payerId: payer.id,
                        orderItemId,
                      })
                    }
                    onSetType={(pt) =>
                      dispatch({
                        type: 'SET_PAYMENT_TYPE',
                        payerId: payer.id,
                        paymentType: pt,
                      })
                    }
                    onSetCash={(v) =>
                      dispatch({
                        type: 'SET_CASH_RECEIVED',
                        payerId: payer.id,
                        value: v,
                      })
                    }
                    onCommit={() => void handleCommitPayer()}
                  />
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* ADR-033 K7b — ödeme geri alma onayı (iç-içe modal pattern'i,
            DetailedPaymentModal→SplitPaymentModal paritesi) */}
        <VoidPaymentDialog
          orderId={voidPaymentId !== null ? orderId : null}
          paymentId={voidPaymentId}
          tableCode={tableCode}
          onOpenChange={(v) => {
            if (!v) setVoidPaymentId(null);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function CounterCell({
  label,
  value,
  color = 'neutral',
}: {
  label: string;
  value: string;
  color?: 'neutral' | 'success' | 'warning' | 'purple';
}) {
  const valueColor =
    color === 'success'
      ? 'var(--v3-success, #1F9D68)'
      : color === 'warning'
        ? 'var(--v3-warning, #D48806)'
        : color === 'purple'
          ? 'var(--v3-purple, #7C5CFA)'
          : 'var(--v3-text-primary)';
  // v3 paritesi — split-payment-summary > div: 1px border, padding 10px 12px
  return (
    <div
      className="flex flex-col rounded-lg"
      style={{
        background: '#fff',
        border: '1px solid var(--v3-border-subtle)',
        padding: '10px 12px',
      }}
    >
      <span
        className="block text-[11px] font-bold uppercase"
        style={{ color: 'var(--v3-text-muted)' }}
      >
        {label}
      </span>
      <strong
        className="mt-1 block text-[20px] tabular-nums"
        style={{ color: valueColor, lineHeight: 1.1 }}
      >
        {value}
      </strong>
    </div>
  );
}

function RemainingItemRow({
  item,
  draft,
  remainingTooLow,
  onAdd,
  disabled,
}: {
  item: SplitStateItem;
  draft: number;
  remainingTooLow: boolean;
  onAdd: () => void;
  disabled: boolean;
}) {
  const available = Math.max(0, item.remaining_quantity - draft);
  const isDisabled = disabled || available <= 0 || remainingTooLow;
  return (
    <div
      className="grid items-center gap-2.5 rounded-lg p-3"
      style={{
        background: '#fff',
        border: '1px solid var(--v3-border-subtle)',
        opacity: isDisabled ? 0.55 : 1,
        minHeight: 72,
        gridTemplateColumns: 'minmax(0, 1fr) auto auto',
      }}
    >
      {/* Sol kolon (split-item-main) — ad + meta */}
      <div className="min-w-0">
        <div
          className="truncate text-[15px] uppercase"
          style={{
            color: 'var(--v3-text-primary)',
            fontWeight: 850,
            lineHeight: 1.25,
          }}
        >
          {item.total_quantity}× {item.product_name}
        </div>
        <div
          className="mt-1 text-[12px] font-bold"
          style={{ color: 'var(--v3-text-muted)' }}
        >
          {`Kalan ${available}`}
        </div>
      </div>
      {/* Orta kolon (split-item-price) — unit + line_total */}
      <div className="text-right" style={{ minWidth: 112 }}>
        <div
          className="text-[14px] tabular-nums"
          style={{ color: 'var(--v3-text-primary)', fontWeight: 850 }}
        >
          {formatMoney(item.unit_price_cents)}
        </div>
        <div
          className="mt-1 text-[12px] font-bold tabular-nums"
          style={{ color: 'var(--v3-text-muted)' }}
        >
          {formatMoney(available * item.unit_price_cents)}
        </div>
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={isDisabled}
        aria-label="Ekle"
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-white disabled:opacity-50"
        style={{ background: 'var(--v3-accent, #6C63FF)' }}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

function PaidGroup({
  group,
  itemMap,
  onVoid,
}: {
  group: SplitStateAllocation;
  itemMap: Map<string, SplitStateItem>;
  /** undefined = yetki yok / işlem sürüyor → buton render edilmez (ADR-033 K6). */
  onVoid?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  // ADR-014 §11 Karar 11.8 — v3 .split-payer-card.is-paid paritesi:
  // bg success-muted + border success + "Ödendi · ₺X" badge
  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: 'var(--v3-success-soft, rgba(31, 157, 104, 0.12))',
        border: '1.5px solid var(--v3-success, #1F9D68)',
        cursor: 'default',
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2.5">
        <strong
          className="text-[13px] font-extrabold"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {group.payer_label ?? `Kişi ${group.payer_no ?? ''}`}
        </strong>
        <span className="flex items-center gap-2">
          <span
            className="text-[12px] font-extrabold tabular-nums"
            style={{ color: 'var(--v3-success, #1F9D68)' }}
          >
            Ödendi · {formatMoney(group.amount_cents)}
          </span>
          {onVoid !== undefined && (
            <button
              type="button"
              onClick={onVoid}
              className="inline-flex h-8 items-center gap-1 rounded-md border bg-white px-2 text-[12px] font-semibold"
              style={{
                borderColor: 'var(--v3-border-subtle)',
                color: 'var(--v3-danger, #D64545)',
              }}
            >
              <Undo2 size={12} />
              {t('payment.void.action')}
            </button>
          )}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {group.items.map((it) => {
          const oi = itemMap.get(it.order_item_id);
          return (
            <div
              key={it.order_item_id}
              className="flex items-center justify-between text-[12px]"
              style={{ color: 'var(--v3-text-primary)' }}
            >
              <span>
                {oi?.product_name ?? '—'} × {it.quantity}
              </span>
              <strong className="tabular-nums">
                {formatMoney(it.line_total_cents)}
              </strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Geri alınmış ödeme kartı — ADR-033 K7: voided satır silinmez, üstü çizili
 * gösterilir. Kaynak GET /payments (split-state voided'ı aritmetikten düşer,
 * satırı döndürmez).
 */
function VoidedPaymentCard({ payment }: { payment: ApiPayment }) {
  const { t } = useTranslation();
  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: 'var(--v3-surface-2, #F1F5FB)',
        border: '1px dashed var(--v3-border-subtle)',
      }}
    >
      <div className="flex items-center justify-between gap-2.5">
        <span
          className="truncate text-[13px] font-bold line-through"
          style={{ color: 'var(--v3-text-muted)' }}
        >
          {payment.payer_label !== null && payment.payer_label !== ''
            ? `${payment.payer_label} · `
            : ''}
          {t(`dashboard.paymentType.${payment.payment_type}`)}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span
            className="text-[12px] font-extrabold tabular-nums line-through"
            style={{ color: 'var(--v3-text-muted)' }}
          >
            {formatMoney(payment.amount_cents)}
          </span>
          <span
            className="rounded px-1.5 py-0.5 text-[11px] font-bold"
            style={{
              background: '#fff',
              color: 'var(--v3-text-muted)',
              border: '1px solid var(--v3-border-subtle)',
            }}
          >
            {t('payment.void.dialog.voidedTag')}
            {payment.void_reason_code !== null
              ? ` · ${t(`payment.void.reason.${payment.void_reason_code}`)}`
              : ''}
          </span>
        </span>
      </div>
    </div>
  );
}

function DraftPayerCard({
  payer,
  isActive,
  canRemove,
  isProcessing,
  itemMap,
  cashReceivedCents,
  changeCents,
  onSelect,
  onRemove,
  onRemoveItem,
  onSetType,
  onSetCash,
  onCommit,
}: {
  payer: Payer;
  isActive: boolean;
  canRemove: boolean;
  isProcessing: boolean;
  itemMap: Map<string, SplitStateItem>;
  cashReceivedCents: number | null;
  changeCents: number;
  onSelect: () => void;
  onRemove: () => void;
  onRemoveItem: (orderItemId: string) => void;
  onSetType: (pt: PaymentType) => void;
  onSetCash: (v: string) => void;
  onCommit: () => void;
}) {
  const total = Object.entries(payer.items).reduce((sum, [itemId, qty]) => {
    const oi = itemMap.get(itemId);
    return sum + (oi?.unit_price_cents ?? 0) * qty;
  }, 0);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className="cursor-pointer rounded-lg p-3"
      style={{
        background: '#fff',
        border: `1px solid ${isActive ? 'var(--v3-accent, #6C63FF)' : 'var(--v3-border-subtle)'}`,
        boxShadow: isActive ? 'inset 0 0 0 1px var(--v3-accent, #6C63FF)' : 'none',
      }}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2.5">
        {/* v3 .split-payer-label: button-chip (40 min-h, 160 min-w, surface-2 bg, border) */}
        <span
          className="inline-flex items-center rounded-lg"
          style={{
            minHeight: 40,
            minWidth: 160,
            border: '1px solid var(--v3-border-subtle)',
            background: 'var(--v3-surface-2, #F1F5FB)',
            padding: '0 14px',
            fontSize: 14,
            fontWeight: 850,
            color: 'var(--v3-text-primary)',
          }}
        >
          {payer.label}
        </span>
        <div className="flex items-center gap-2">
          <span
            className="text-[13px] tabular-nums"
            style={{
              color: 'var(--v3-text-secondary)',
              fontWeight: 800,
              whiteSpace: 'nowrap',
            }}
          >
            {formatMoney(total)}
          </span>
          {canRemove && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  onRemove();
                }
              }}
              aria-label="Kişi sil"
              className="inline-flex cursor-pointer items-center justify-center rounded-lg"
              style={{
                width: 28,
                height: 28,
                border: '1px solid var(--v3-border-subtle)',
                background: 'transparent',
                color: 'var(--v3-danger, #D64545)',
              }}
            >
              <X size={14} />
            </span>
          )}
        </div>
      </div>

      {/* Allocated items */}
      {Object.keys(payer.items).length === 0 ? (
        <div
          className="rounded-lg border border-dashed text-center"
          style={{
            borderColor: 'var(--v3-border-subtle)',
            color: 'var(--v3-text-muted)',
            padding: 12,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          Soldan ürün ekleyin
        </div>
      ) : (
        <div className="mb-2.5 flex flex-col" style={{ gap: 6 }}>
          {Object.entries(payer.items).map(([itemId, qty]) => {
            const oi = itemMap.get(itemId);
            if (oi === undefined || qty <= 0) return null;
            return (
              <div
                key={itemId}
                className="flex items-center justify-between rounded-lg"
                style={{
                  background: 'var(--v3-surface-2, #F1F5FB)',
                  minHeight: 34,
                  padding: '7px 9px',
                  fontSize: 13,
                  gap: 10,
                }}
              >
                <span style={{ color: 'var(--v3-text-primary)' }}>
                  {qty}× {oi.product_name}
                </span>
                <div className="flex items-center" style={{ gap: 8 }}>
                  <span className="tabular-nums" style={{ color: 'var(--v3-text-secondary)' }}>
                    {formatMoney(oi.unit_price_cents * qty)}
                  </span>
                  {isActive && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveItem(itemId);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation();
                          onRemoveItem(itemId);
                        }
                      }}
                      className="inline-flex cursor-pointer items-center justify-center rounded-lg"
                      style={{
                        width: 28,
                        height: 28,
                        border: '1px solid var(--v3-border-subtle)',
                        background: 'transparent',
                        color: 'var(--v3-danger, #D64545)',
                      }}
                      aria-label="Çıkar"
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

      {isActive && (
        <div className="flex flex-col gap-2">
          {/* Nakit/Kart 2-buton */}
          <div className="grid grid-cols-2 gap-2">
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onSetType('cash');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  onSetType('cash');
                }
              }}
              className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md text-[12px] font-bold"
              style={{
                background:
                  payer.paymentType === 'cash' ? 'var(--v3-purple, #7C5CFA)' : '#fff',
                color: payer.paymentType === 'cash' ? '#fff' : 'var(--v3-text-primary)',
                border:
                  payer.paymentType === 'cash'
                    ? 'none'
                    : '1px solid var(--v3-border-subtle)',
              }}
            >
              <Banknote size={14} /> Nakit
            </span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onSetType('card');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  onSetType('card');
                }
              }}
              className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md text-[12px] font-bold"
              style={{
                background:
                  payer.paymentType === 'card' ? 'var(--v3-purple, #7C5CFA)' : '#fff',
                color: payer.paymentType === 'card' ? '#fff' : 'var(--v3-text-primary)',
                border:
                  payer.paymentType === 'card'
                    ? 'none'
                    : '1px solid var(--v3-border-subtle)',
              }}
            >
              <CreditCard size={14} /> Kredi Kartı
            </span>
          </div>

          {/* Cash received + Tam buton + Para üstü (v3 paritesi) */}
          {payer.paymentType === 'cash' && total > 0 && (
            <div
              className="flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="number"
                step="0.01"
                value={payer.cashReceivedInput}
                onChange={(e) => onSetCash(e.target.value)}
                placeholder={(total / 100).toFixed(2)}
                className="h-9 w-32 rounded-md border px-2 text-sm"
                style={{ borderColor: 'var(--v3-border-subtle)' }}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSetCash((total / 100).toFixed(2));
                }}
                className="inline-flex h-9 items-center rounded-md border bg-white px-3 text-[12px] font-semibold"
                style={{ borderColor: 'var(--v3-border-subtle)' }}
              >
                Tam
              </button>
              <span className="ml-auto text-[12px]" style={{ color: 'var(--v3-text-muted)' }}>
                Para üstü:{' '}
                <strong style={{ color: 'var(--v3-text-primary)' }}>
                  {formatMoney(changeCents)}
                </strong>
              </span>
            </div>
          )}

          {/* Bu kişiden ödemeyi al */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCommit();
            }}
            disabled={isProcessing || total <= 0}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: 'var(--v3-success, #1F9D68)' }}
          >
            {isProcessing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}
            Bu kişiden ödemeyi al
          </button>
        </div>
      )}
    </div>
  );
}
