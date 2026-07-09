import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import type { IncomingCallEvent } from '@restoran-pos/shared-types';
import { useIncomingCallSocket } from './hooks/useIncomingCallSocket';
import { useUpdateCallStatus } from './api/calls';
import { callToTakeawayRoute } from './orderRoute';
import { IncomingCallPopup } from './IncomingCallPopup';

/**
 * IncomingCallProvider — Caller ID popup orchestration (ADR-016 §11).
 *
 * - Socket.IO `caller.incoming` event'inde popup gösterir.
 * - Per-tab session suppression: kullanıcı X'lediğinde sayfa yenilenene kadar
 *   aynı `callLogId` tekrar görünmez (sessionStorage flag).
 * - "Sipariş Aç" → status='opened_order' + paket sipariş route'una navigate.
 *   Route henüz tanımlı olmadığı için fallback `/dashboard` (TODO: PR-8c-2+).
 */

interface IncomingCallContextValue {
  currentCall: IncomingCallEvent | null;
  dismiss: () => void;
  openOrder: () => void;
}

const IncomingCallContext = createContext<IncomingCallContextValue | undefined>(
  undefined,
);

const SUPPRESS_KEY_PREFIX = 'caller-id:dismissed:';

function isSuppressed(callLogId: string): boolean {
  try {
    return sessionStorage.getItem(SUPPRESS_KEY_PREFIX + callLogId) === '1';
  } catch {
    return false;
  }
}

function markSuppressed(callLogId: string): void {
  try {
    sessionStorage.setItem(SUPPRESS_KEY_PREFIX + callLogId, '1');
  } catch {
    /* sessionStorage erişilemez (private mode) — sessizce yut */
  }
}

interface IncomingCallProviderProps {
  children: ReactNode;
}

export function IncomingCallProvider({
  children,
}: IncomingCallProviderProps): JSX.Element {
  const [currentCall, setCurrentCall] = useState<IncomingCallEvent | null>(null);
  const updateStatus = useUpdateCallStatus();
  const navigate = useNavigate();

  useIncomingCallSocket((payload) => {
    if (isSuppressed(payload.callLogId)) return;
    setCurrentCall(payload);
  });

  const dismiss = useCallback((): void => {
    const call = currentCall;
    if (call === null) return;
    markSuppressed(call.callLogId);
    setCurrentCall(null);
    updateStatus.mutate({ id: call.callLogId, status: 'dismissed' });
  }, [currentCall, updateStatus]);

  const openOrder = useCallback((): void => {
    const call = currentCall;
    if (call === null) return;
    if (call.customer?.isBlacklisted === true) return;
    markSuppressed(call.callLogId);
    setCurrentCall(null);
    updateStatus.mutate({ id: call.callLogId, status: 'opened_order' });
    // "Sipariş Aç" → paket sipariş başlat (ADR-016 §11): bilinen müşteri
    // ön-seçili, bilinmeyen arayan telefonla müşteri-seçici ön-dolu. Eski
    // `/customers/:id` (müşteri DÜZENLEME) yanlıştı — PR-8c-2 placeholder.
    navigate(callToTakeawayRoute(call.customer?.id ?? null, call.normalizedPhone));
  }, [currentCall, navigate, updateStatus]);

  const value = useMemo<IncomingCallContextValue>(
    () => ({ currentCall, dismiss, openOrder }),
    [currentCall, dismiss, openOrder],
  );

  return (
    <IncomingCallContext.Provider value={value}>
      {children}
      {currentCall !== null && (
        <IncomingCallPopup
          call={currentCall}
          onDismiss={dismiss}
          onOpenOrder={openOrder}
        />
      )}
    </IncomingCallContext.Provider>
  );
}

export function useIncomingCall(): IncomingCallContextValue {
  const ctx = useContext(IncomingCallContext);
  if (ctx === undefined) {
    throw new Error('useIncomingCall must be used within IncomingCallProvider');
  }
  return ctx;
}
