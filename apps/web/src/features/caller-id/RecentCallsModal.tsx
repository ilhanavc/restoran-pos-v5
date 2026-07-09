import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, PhoneOff, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import type { CallLog, CallLogStatus } from '@restoran-pos/shared-types';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { formatTrPhone } from '../../lib/phone';
import { useCallLogs, useUpdateCallStatus } from './api/calls';
import { callToTakeawayRoute } from './orderRoute';

/**
 * RecentCallsModal — "Çağrılar" butonu → son çağrılar (call log) listesi
 * (ADR-016 §11; Caller ID on-demand geçmiş). IncomingCallPopup'ın liste hâli:
 * her satır müşteri adı + telefon + saat + renk-kodlu durum; tıkla → "Sipariş Aç"
 * (popup akışı: müşteri sayfası + status='opened_order'). Kara-liste satırı
 * aksiyonsuz. İlk sürüm (S90): kaçırılan-sayaç rozeti + "geri ara" v5.1 backlog.
 *
 * Renkler IncomingCallPopup paritesi (Tailwind tema caller-id için tanımsız).
 */

const TEXT_MUTED = '#6C7A92';
const BORDER_NEUTRAL = '#E2E8F0';
const SUCCESS_BG = '#DCFCE7';
const SUCCESS_FG = '#1F9D68';
const DANGER = '#DC2626';
const DANGER_BG = '#FEE2E2';
const INFO_BG = '#DBEAFE';
const INFO_FG = '#2563EB';

/**
 * Durum → renk (Figure POS emsali): mavi=görülmedi/bekliyor · kırmızı=sipariş
 * açılmadı (kaçırıldı) · yeşil=sipariş açıldı/tamamlandı.
 */
const STATUS_COLOR: Readonly<Record<CallLogStatus, { bg: string; fg: string }>> = {
  ringing: { bg: INFO_BG, fg: INFO_FG },
  dismissed: { bg: DANGER_BG, fg: DANGER },
  opened_order: { bg: SUCCESS_BG, fg: SUCCESS_FG },
  completed: { bg: SUCCESS_BG, fg: SUCCESS_FG },
};

const TIME_FMT = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

interface RecentCallsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RecentCallsModal({
  open,
  onOpenChange,
}: RecentCallsModalProps): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const callsQuery = useCallLogs(50, open);
  const updateStatus = useUpdateCallStatus();
  const calls = callsQuery.data ?? [];

  const handleOpenOrder = (call: CallLog): void => {
    if (call.isBlacklisted === true) return;
    // Henüz ele alınmamış çağrıyı 'opened_order'a taşı (geri-transition YAPMA:
    // opened_order/completed'i tekrar işaretleme). IncomingCallProvider paritesi.
    if (call.status === 'ringing' || call.status === 'dismissed') {
      updateStatus.mutate(
        { id: call.id, status: 'opened_order' },
        // Durum güncelleme arka-plan defter işi; başarısızsa sessiz kalma
        // (Nielsen #9). Navigate yine de yapılır — asıl aksiyon sipariş açmak.
        { onError: () => toast.error(t('caller.statusUpdateError')) },
      );
    }
    onOpenChange(false);
    // "Sipariş Aç" → paket sipariş başlat: bilinen müşteri ön-seçili,
    // bilinmeyen arayan telefonla müşteri-seçici ön-dolu (ADR-016 §11).
    navigate(callToTakeawayRoute(call.customerId, call.normalizedPhone));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col gap-0 overflow-hidden p-0"
        style={{
          width: 'min(560px, 96vw)',
          maxWidth: 'min(560px, 96vw)',
          height: 'min(680px, 90vh)',
          maxHeight: 'min(680px, 90vh)',
        }}
      >
        {/* Header */}
        <div
          className="shrink-0 border-b px-5 py-4"
          style={{ borderColor: BORDER_NEUTRAL }}
        >
          <DialogTitle
            className="text-[18px] font-extrabold"
            style={{ color: '#0F172A' }}
          >
            {t('caller.recentTitle')}
          </DialogTitle>
          <DialogDescription
            className="mt-1 text-[12px]"
            style={{ color: TEXT_MUTED }}
          >
            {t('caller.recentSubtitle')}
          </DialogDescription>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {callsQuery.isLoading ? (
            <div className="flex h-full items-center justify-center py-12">
              <Loader2
                size={28}
                className="animate-spin"
                style={{ color: TEXT_MUTED }}
              />
            </div>
          ) : callsQuery.isError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              <p className="text-sm" style={{ color: DANGER }}>
                {t('caller.recentError')}
              </p>
              <button
                type="button"
                onClick={() => void callsQuery.refetch()}
                className="inline-flex items-center rounded-lg border px-4 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
                style={{ minHeight: 44, borderColor: BORDER_NEUTRAL, color: '#0F172A' }}
              >
                {t('caller.retry')}
              </button>
            </div>
          ) : calls.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              <PhoneOff size={40} strokeWidth={1.5} style={{ color: TEXT_MUTED }} />
              <p className="text-sm font-medium" style={{ color: TEXT_MUTED }}>
                {t('caller.recentEmpty')}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col">
              {calls.map((call) => (
                <CallRow
                  key={call.id}
                  call={call}
                  onOpenOrder={() => handleOpenOrder(call)}
                />
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CallRow({
  call,
  onOpenOrder,
}: {
  call: CallLog;
  onOpenOrder: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const isBlacklisted = call.isBlacklisted === true;
  const statusColor = STATUS_COLOR[call.status];
  const name = call.customerName ?? t('caller.unknownCaller');
  const phone =
    call.normalizedPhone !== null
      ? formatTrPhone(call.normalizedPhone)
      : (call.rawPhone ?? '—');
  const time = TIME_FMT.format(new Date(call.receivedAt));

  return (
    <li>
      <button
        type="button"
        onClick={onOpenOrder}
        disabled={isBlacklisted}
        title={isBlacklisted ? t('caller.blacklistedDisabledTooltip') : undefined}
        className="flex w-full items-center gap-3 border-b px-5 py-3 text-left transition-colors disabled:cursor-not-allowed enabled:hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
        style={{
          borderColor: BORDER_NEUTRAL,
          minHeight: 64,
          ...(isBlacklisted ? { background: DANGER_BG, opacity: 0.85 } : {}),
        }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="truncate text-[15px] font-bold"
              style={{ color: '#0F172A' }}
            >
              {name}
            </span>
            {isBlacklisted && (
              <span
                className="shrink-0 text-[10px] font-extrabold"
                style={{ color: DANGER }}
              >
                {t('caller.blacklisted')}
              </span>
            )}
          </div>
          <div
            className="mt-0.5 text-[13px] tabular-nums"
            style={{ color: TEXT_MUTED }}
          >
            {phone} · {time}
          </div>
        </div>

        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase"
          style={{
            background: statusColor.bg,
            color: statusColor.fg,
            letterSpacing: '0.04em',
          }}
        >
          {t(`caller.status.${call.status}`)}
        </span>

        {!isBlacklisted && (
          <span
            className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold"
            style={{ color: INFO_FG }}
          >
            <ShoppingBag size={16} aria-hidden="true" />
            {t('caller.openOrder')}
          </span>
        )}
      </button>
    </li>
  );
}
