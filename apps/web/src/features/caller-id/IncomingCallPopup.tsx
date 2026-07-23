import { useState, type CSSProperties } from 'react';
import { Phone, ShoppingBag, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { IncomingCallEvent } from '@restoran-pos/shared-types';
import { formatTrPhone } from '../../lib/phone';

/**
 * IncomingCallPopup — v3 birebir görsel parite (mor accent, üst-orta sabit).
 *
 * Inline stil tercih edildi çünkü Tailwind tema değişkenleri henüz caller-id
 * için tanımlı değil; v3 referansındaki ölçü/renkler doğrudan koruma altına
 * alınıyor (ADR-016 §11 + UI rehberi).
 *
 * Erişilebilirlik:
 *   - role="alertdialog" (kullanıcı eylem bekleyen kritik bildirim)
 *   - aria-labelledby header'a; aria-describedby tanınan müşteride ad+telefon,
 *     bilinmeyende yalnız telefon (S104 — ad birincil satıra alındı)
 *   - close butonu min 44x44 dokunma hedefi (POS HCI checklist)
 */

const ACCENT = '#6C63FF';
const ACCENT_HOVER = '#5A52E8';
const ACCENT_SOFT = '#EEEAFE';
const TEXT_MUTED = '#6C7A92';
const BORDER_NEUTRAL = '#E2E8F0';
const SUCCESS_BG = '#DCFCE7';
const SUCCESS_FG = '#1F9D68';
const WARNING_BG = '#FEF3C7';
const WARNING_FG = '#B45309';
const DANGER = '#DC2626';
const DANGER_BG = '#FEE2E2';

interface IncomingCallPopupProps {
  call: IncomingCallEvent;
  onDismiss: () => void;
  onOpenOrder: () => void;
}

export function IncomingCallPopup({
  call,
  onDismiss,
  onOpenOrder,
}: IncomingCallPopupProps): JSX.Element {
  const { t } = useTranslation();
  const [openHover, setOpenHover] = useState(false);
  const isBlacklisted = call.customer?.isBlacklisted === true;
  const isRegistered = call.customer !== null;

  const wrapperStyle: CSSProperties = {
    position: 'fixed',
    top: 12,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 10050,
    width: 'min(440px, calc(100vw - 24px))',
    background: '#FFFFFF',
    border: `2px solid ${isBlacklisted ? DANGER : ACCENT}`,
    borderRadius: 12,
    boxShadow: '0 20px 48px rgba(2, 6, 23, 0.34)',
    padding: '14px 16px',
    fontFamily: 'inherit',
    color: '#0F172A',
  };

  const innerRow: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
  };

  const avatarStyle: CSSProperties = {
    width: 44,
    height: 44,
    borderRadius: '50%',
    background: isBlacklisted ? DANGER_BG : ACCENT_SOFT,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  };

  const contentStyle: CSSProperties = { flex: 1, minWidth: 0 };

  const headerStyle: CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    color: TEXT_MUTED,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  };

  /**
   * Birincil kimlik satırı. Müşteri TANINIYORSA ad, tanınmıyorsa telefon.
   * Kasiyer telefonu ezberlemez, ismi tanır — bu yüzden ad öne alındı
   * (ürün sahibi talebi, S104).
   */
  const primaryIdentityStyle: CSSProperties = {
    fontSize: 19,
    fontWeight: 800,
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  /** Tanınan müşteride telefon ikincil satıra iner (sönük + küçük). */
  const phoneSecondaryStyle: CSSProperties = {
    fontSize: 14,
    fontWeight: 600,
    color: TEXT_MUTED,
    marginTop: 3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  const addressStyle: CSSProperties = {
    fontSize: 12,
    color: TEXT_MUTED,
    marginTop: 4,
    lineHeight: 1.35,
  };

  const badgeBaseStyle: CSSProperties = {
    display: 'inline-block',
    marginTop: 8,
    fontSize: 10,
    fontWeight: 700,
    padding: '3px 8px',
    borderRadius: 999,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  };

  let badgeStyle: CSSProperties;
  let badgeText: string;
  if (isBlacklisted) {
    badgeStyle = { ...badgeBaseStyle, background: DANGER_BG, color: DANGER };
    badgeText = t('caller.blacklisted');
  } else if (isRegistered) {
    badgeStyle = {
      ...badgeBaseStyle,
      background: SUCCESS_BG,
      color: SUCCESS_FG,
    };
    badgeText = t('caller.registeredCustomer');
  } else {
    badgeStyle = {
      ...badgeBaseStyle,
      background: WARNING_BG,
      color: WARNING_FG,
    };
    badgeText = t('caller.newNumber');
  }

  const closeBtnStyle: CSSProperties = {
    background: 'transparent',
    padding: 8,
    minHeight: 44,
    minWidth: 44,
    border: `1px solid ${BORDER_NEUTRAL}`,
    borderRadius: 8,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    color: TEXT_MUTED,
  };

  const footerStyle: CSSProperties = {
    display: 'flex',
    gap: 8,
    marginTop: 12,
    justifyContent: 'flex-end',
  };

  const dismissBtnStyle: CSSProperties = {
    background: 'transparent',
    color: TEXT_MUTED,
    border: `1px solid ${BORDER_NEUTRAL}`,
    padding: '6px 12px',
    fontSize: 12,
    minHeight: 48,
    borderRadius: 8,
    cursor: 'pointer',
    fontWeight: 500,
  };

  const openBtnStyle: CSSProperties = {
    background: isBlacklisted
      ? '#94A3B8'
      : openHover
        ? ACCENT_HOVER
        : ACCENT,
    color: 'white',
    padding: '6px 12px',
    fontSize: 12,
    minHeight: 48,
    borderRadius: 8,
    fontWeight: 600,
    border: 'none',
    cursor: isBlacklisted ? 'not-allowed' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    opacity: isBlacklisted ? 0.7 : 1,
  };

  const defaultAddress =
    call.customer?.addresses.find((a) => a.isDefault) ??
    call.customer?.addresses[0] ??
    null;

  return (
    <div
      role="alertdialog"
      aria-labelledby="caller-popup-header"
      aria-describedby={
        call.customer !== null
          ? 'caller-popup-name caller-popup-phone'
          : 'caller-popup-phone'
      }
      style={wrapperStyle}
      data-testid="incoming-call-popup"
    >
      <div style={innerRow}>
        <div style={avatarStyle} aria-hidden="true">
          <Phone size={22} color={isBlacklisted ? DANGER : ACCENT} />
        </div>

        <div style={contentStyle}>
          <div id="caller-popup-header" style={headerStyle}>
            {t('caller.incomingCall')}
          </div>
          {/* Tanınan müşteride AD birincil, telefon ikincil; bilinmeyen
              arayanda telefon birincil kalır (aksi hâlde belirgin satır
              boş kalırdı). */}
          {call.customer !== null ? (
            <>
              <div id="caller-popup-name" style={primaryIdentityStyle}>
                {call.customer.fullName}
              </div>
              <div id="caller-popup-phone" style={phoneSecondaryStyle}>
                {formatTrPhone(call.normalizedPhone)}
              </div>
            </>
          ) : (
            <div id="caller-popup-phone" style={primaryIdentityStyle}>
              {formatTrPhone(call.normalizedPhone)}
            </div>
          )}

          {defaultAddress !== null && (
            <div style={addressStyle}>
              {[
                defaultAddress.title,
                defaultAddress.addressLine,
                defaultAddress.neighborhood,
                defaultAddress.district,
              ]
                .filter((p): p is string => Boolean(p))
                .join(' · ')}
            </div>
          )}

          <span style={badgeStyle}>{badgeText}</span>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('caller.closeAriaLabel')}
          style={closeBtnStyle}
        >
          <X size={18} />
        </button>
      </div>

      <div style={footerStyle}>
        <button type="button" onClick={onDismiss} style={dismissBtnStyle}>
          {t('caller.dismiss')}
        </button>
        <button
          type="button"
          onClick={onOpenOrder}
          disabled={isBlacklisted}
          title={isBlacklisted ? t('caller.blacklistedDisabledTooltip') : undefined}
          style={openBtnStyle}
          onMouseEnter={() => setOpenHover(true)}
          onMouseLeave={() => setOpenHover(false)}
          onFocus={() => setOpenHover(true)}
          onBlur={() => setOpenHover(false)}
        >
          <ShoppingBag size={14} />
          {t('caller.openOrder')}
        </button>
      </div>
    </div>
  );
}
