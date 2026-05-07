import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Clock, MoreVertical, Printer, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { formatMoney } from '@restoran-pos/shared-domain';
import {
  useCancelTakeawayOrder,
  useUpdateTakeawayStage,
  type OpenTakeawayOrderRow,
  type TakeawayStage,
} from '../api';

interface TakeawayOrderCardProps {
  order: OpenTakeawayOrderRow;
  /** Karta tıklayınca detay (ileride sipariş düzenleme ekranı). Şu an opsiyonel. */
  onOpen?: (orderId: string) => void;
}

/**
 * Açık paket sipariş kartı — v3 paritesi (TablesScreen.jsx L880-1126 referans).
 *
 * Sorumluluklar:
 * - 1sn refresh ile elapsed timer ("X sa Y dk Z sn" formatı, v3 paritesi)
 * - Sol şerit: preparing → warning, out_for_delivery → info
 * - Gradient arka plan: preparing (warm) / out_for_delivery (cool blue)
 * - 3-nokta menü: Yazdır (stub, print agent ayrı PR) + İptal (POST /orders/:id/cancel)
 * - Outside-click ile menü kapanır
 * - Aksiyon butonları: "Teslimata Çıkarıldı" (preparing aktif) /
 *   "Teslim Edildi" (out_for_delivery aktif). delivered statüsü liste
 *   filtresinden dolayı bu karta düşmez.
 *
 * Not: Görsel v3 ile birebir aynıdır; CSS değişkenleri (`--warning`,
 * `--info-soft` vb.) `apps/web/src/styles/globals.css` :root altında
 * v3 light theme'inden port edilmiştir.
 */
export function TakeawayOrderCard({ order, onOpen }: TakeawayOrderCardProps) {
  const { t } = useTranslation();
  const updateStage = useUpdateTakeawayStage();
  const cancelOrder = useCancelTakeawayOrder();

  // 1sn tick — timer'ı canlı tutar.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, []);

  // Menü state + outside-click handler.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const stage: TakeawayStage = order.takeawayStage;
  const isOut = stage === 'out_for_delivery';

  const isPending = updateStage.isPending;
  const isCancelling = cancelOrder.isPending;
  const isBusy = isPending || isCancelling;

  const customerName = order.customerName?.trim() || t('takeaway.actions.fallbackCustomer');
  const elapsedLabel = formatOrderElapsed(order.createdAt, now, t);

  const handlePrint = () => {
    // Print Agent ayrı PR. Şimdilik stub bilgi mesajı.
    setMenuOpen(false);
    toast.info(t('takeaway.print.stub'));
  };

  const handleCancel = async () => {
    setMenuOpen(false);
    try {
      await cancelOrder.mutateAsync(order.id);
      toast.success(t('takeaway.cancelSuccess'));
    } catch (err) {
      const fallback = t('takeaway.cancelFailed');
      if (isAxiosError(err)) {
        const data = err.response?.data as { error?: { message?: string } } | undefined;
        toast.error(data?.error?.message ?? fallback);
      } else {
        toast.error(fallback);
      }
    }
  };

  const goNextStage = async (next: 'out_for_delivery' | 'delivered') => {
    try {
      await updateStage.mutateAsync({ orderId: order.id, stage: next });
      toast.success(t('takeaway.success.stageUpdated'));
    } catch (err) {
      const fallback = t('takeaway.errors.stageFailed');
      if (isAxiosError(err)) {
        const data = err.response?.data as { error?: { message?: string } } | undefined;
        toast.error(data?.error?.message ?? fallback);
      } else {
        toast.error(fallback);
      }
    }
  };

  const canMarkOut = stage === 'preparing' && !isBusy;
  const canMarkDelivered = isOut && !isBusy;

  // v3 btnBase paritesi (TablesScreen.jsx L510-518).
  const btnBase = {
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 700 as const,
    flex: 1,
  };

  // Gradient + border, stage'e göre.
  const containerStyle: React.CSSProperties = {
    position: 'relative',
    borderRadius: 8,
    minHeight: 184,
    border: `1px solid ${isOut ? 'var(--info)' : 'var(--v3-border-subtle)'}`,
    background: isOut
      ? 'linear-gradient(145deg, var(--info-soft), var(--surface-1) 46%, var(--surface-2))'
      : 'linear-gradient(145deg, var(--accent-soft), var(--surface-1) 44%, var(--success-soft))',
    boxShadow: menuOpen ? 'var(--shadow-lg)' : 'var(--shadow-soft)',
    overflow: 'hidden',
    flexShrink: 0,
    transition: 'transform 120ms ease, border-color 120ms ease',
  };

  return (
    <div
      data-testid={`takeaway-order-card-${order.id}`}
      style={containerStyle}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.borderColor = 'var(--border-light)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.borderColor = isOut
          ? 'var(--info)'
          : 'var(--v3-border-subtle)';
      }}
    >
      {/* Sol kenar şerit — stage rengi (v3 L899-910). */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          background: isOut ? 'var(--info)' : 'var(--warning)',
          opacity: 0.95,
        }}
      />

      {/* 3-nokta menü (sağ üst). v3 L911-1009. */}
      <div
        ref={menuRef}
        style={{ position: 'absolute', top: 8, right: 8, zIndex: 3 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label={t('takeaway.actions.menuAriaLabel')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={isBusy}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          style={{
            width: 32,
            height: 32,
            minHeight: 32,
            padding: 0,
            borderRadius: 8,
            background: menuOpen ? 'var(--bg-tertiary)' : 'var(--surface-overlay)',
            border: '1px solid var(--v3-border-subtle)',
            color: 'var(--text-primary)',
            opacity: isBusy ? 0.55 : 1,
            cursor: isBusy ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MoreVertical size={17} />
        </button>
        {menuOpen && (
          <div
            role="menu"
            aria-label={t('takeaway.actions.menuAriaLabel')}
            style={{
              position: 'absolute',
              top: 38,
              right: 0,
              width: 148,
              padding: 6,
              borderRadius: 8,
              border: '1px solid var(--v3-border-subtle)',
              background: 'var(--bg-tertiary)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <button
              type="button"
              role="menuitem"
              disabled={isBusy}
              onClick={handlePrint}
              style={menuItemStyle('var(--text-primary)', isBusy)}
            >
              <Printer size={15} color="#6C63FF" />
              {isBusy ? t('takeaway.actions.printing') : t('takeaway.actions.print')}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={isBusy}
              onClick={handleCancel}
              style={menuItemStyle('var(--danger)', isBusy)}
            >
              <Undo2 size={15} />
              {isCancelling
                ? t('takeaway.actions.cancelling')
                : t('takeaway.actions.cancel')}
            </button>
          </div>
        )}
      </div>

      {/* Card body — clickable. v3 L1010-1082. */}
      <button
        type="button"
        onClick={() => onOpen?.(order.id)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '14px 48px 10px 16px',
          border: 'none',
          background: 'transparent',
          color: 'var(--text-primary)',
          cursor: onOpen ? 'pointer' : 'default',
          fontFamily: 'inherit',
        }}
      >
        {/* Timer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, paddingRight: 4 }}>
          {elapsedLabel && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--warning)',
                fontWeight: 800,
                whiteSpace: 'nowrap',
              }}
            >
              {elapsedLabel}
            </div>
          )}
        </div>

        {/* Müşteri adı */}
        <div style={{ marginTop: 12, minHeight: 42, paddingRight: 2 }}>
          <div
            style={{
              fontSize: 19,
              lineHeight: 1.18,
              fontWeight: 850,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {customerName}
          </div>
        </div>

        {/* Tutar */}
        <div
          style={{
            marginTop: 14,
            fontSize: 28,
            fontWeight: 900,
            letterSpacing: 0,
            lineHeight: 1,
            color: 'var(--text-primary)',
          }}
        >
          {formatMoney(order.totalCents)}
        </div>

        {/* Status badge */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, minHeight: 22 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              borderRadius: 8,
              padding: '4px 8px',
              border: `1px solid ${isOut ? 'var(--info)' : 'var(--warning)'}`,
              background: isOut ? 'var(--info-muted)' : 'var(--warning-muted)',
              color: isOut ? 'var(--info)' : 'var(--warning)',
              fontSize: 10,
              fontWeight: 850,
              textTransform: 'uppercase',
            }}
          >
            <Clock size={11} />
            {isOut
              ? t('takeaway.card.stage.outForDelivery')
              : t('takeaway.card.stage.preparing')}
          </span>
        </div>
      </button>

      {/* Aksiyon butonları. v3 L1083-1124. */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '0 12px 12px 16px',
          flexWrap: 'wrap',
          position: 'relative',
          zIndex: 2,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          disabled={!canMarkOut}
          onClick={() => goNextStage('out_for_delivery')}
          style={{
            ...btnBase,
            background: isOut ? 'var(--bg-tertiary)' : 'var(--warning-muted)',
            color: isOut ? 'var(--text-muted)' : 'var(--warning)',
            border: `1px solid ${isOut ? 'var(--v3-border-subtle)' : 'var(--warning)'}`,
            cursor: canMarkOut ? 'pointer' : 'not-allowed',
            opacity: canMarkOut ? 1 : 0.65,
          }}
        >
          {isPending && stage === 'preparing'
            ? t('takeaway.actions.processing')
            : t('takeaway.actions.outForDelivery')}
        </button>
        <button
          type="button"
          disabled={!canMarkDelivered}
          onClick={() => goNextStage('delivered')}
          style={{
            ...btnBase,
            background: canMarkDelivered ? 'var(--success-muted)' : 'var(--bg-tertiary)',
            color: canMarkDelivered ? 'var(--success)' : 'var(--text-muted)',
            border: `1px solid ${canMarkDelivered ? 'var(--success)' : 'var(--v3-border-subtle)'}`,
            cursor: canMarkDelivered ? 'pointer' : 'not-allowed',
            opacity: canMarkDelivered ? 1 : 0.65,
          }}
        >
          {isPending && stage === 'out_for_delivery'
            ? t('takeaway.actions.processing')
            : t('takeaway.actions.delivered')}
        </button>
      </div>
    </div>
  );
}

/**
 * v3 paritesi: "X sa Y dk Z sn" / "X dk Y sn" / "Y sn" formatı.
 * 24sa+ olunca "N gün ..." prefix'i eklenir.
 *
 * @param dateIso ISO timestamp (order.createdAt)
 * @param now epoch ms (state'ten gelen "şimdi")
 * @param t i18n translator
 */
function formatOrderElapsed(
  dateIso: string,
  now: number,
  t: TFunction,
): string {
  const startedAt = new Date(dateIso).getTime();
  if (!Number.isFinite(startedAt)) return '';
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours >= 24) {
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return t('takeaway.timer.withDays', {
      d: days,
      h: hours,
      m: minutes,
      s: seconds,
    });
  }
  if (totalHours >= 1) {
    return t('takeaway.timer.withHours', {
      h: totalHours,
      m: minutes,
      s: seconds,
    });
  }
  return t('takeaway.timer.short', { m: totalMinutes, s: seconds });
}

function menuItemStyle(color: string, disabled: boolean): React.CSSProperties {
  return {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '9px 10px',
    border: 'none',
    borderRadius: 7,
    background: 'transparent',
    color,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 700,
    textAlign: 'left',
  };
}
