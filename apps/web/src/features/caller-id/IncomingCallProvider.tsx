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
 * - "Sipariş Aç" → status='opened_order' + paket sipariş route'una navigate.
 *
 * S105 (ürün sahibi: *"ne zaman ararsa arasın pop-up açılması lazım her
 * zaman"*) — üç davranış değişti:
 *
 *  1. **Her çağrı popup'ı YENİDEN açar.** Eskiden popup açıkken gelen ikinci
 *     çağrı yalnız `setCurrentCall` ile içeriği değiştiriyordu; aynı numara
 *     tekrar aradığında ad/telefon aynı olduğu için ekranda HİÇBİR ŞEY
 *     değişmiyor, kullanıcı ikinci çağrıyı fark etmiyordu. Artık popup
 *     `callLogId + receivedAt` anahtarıyla remount edilir (aynı satır id'siyle
 *     gelen tekrar çağrılar da yeniden açar — API 1dk/2-satır sınırında aynı
 *     id ile emit eder).
 *  2. **Kalıcı bastırma (sessionStorage) KALDIRILDI.** Amacı, kapatılan
 *     çağrının reconnect telafisiyle (S104 #475) yeniden açılmasını önlemekti;
 *     ama aynı çağrı kaydı için gelen HER emit'i sonsuza dek susturduğu için
 *     ürün sahibinin kararıyla çelişiyordu. Telafi zaten `status='ringing'`
 *     filtreli: kapatılan çağrı `dismissed` olduğu için replay onu göndermez.
 *  3. **Yarış koşulu düzeltildi.** `dismiss`/`openOrder` artık kapattıkları
 *     çağrıyı parametre olarak alır. Eskiden closure'daki `currentCall`'u
 *     okuyorlardı: birinci popup kapatılırken ikinci çağrı gelirse tıklama
 *     İKİNCİ çağrıyı `dismissed` işaretliyordu — kullanıcı onu hiç görmeden
 *     kaybediyordu.
 */

interface IncomingCallContextValue {
  currentCall: IncomingCallEvent | null;
  dismiss: () => void;
  openOrder: () => void;
}

const IncomingCallContext = createContext<IncomingCallContextValue | undefined>(
  undefined,
);

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
    setCurrentCall(payload);
  });

  /** Kapatılan çağrı AÇIKÇA verilir — aradaki yeni çağrı yanlışlıkla kapanmasın. */
  const dismissCall = useCallback(
    (call: IncomingCallEvent): void => {
      setCurrentCall((shown) =>
        shown?.callLogId === call.callLogId ? null : shown,
      );
      updateStatus.mutate({ id: call.callLogId, status: 'dismissed' });
    },
    [updateStatus],
  );

  const openOrderForCall = useCallback(
    (call: IncomingCallEvent): void => {
      if (call.customer?.isBlacklisted === true) return;
      setCurrentCall((shown) =>
        shown?.callLogId === call.callLogId ? null : shown,
      );
      updateStatus.mutate({ id: call.callLogId, status: 'opened_order' });
      navigate(
        callToTakeawayRoute(call.customer?.id ?? null, call.normalizedPhone),
      );
    },
    [navigate, updateStatus],
  );

  // Context API'si (dışarıdan tetikleme) — o an gösterilen çağrıya uygulanır.
  const dismiss = useCallback((): void => {
    const call = currentCall;
    if (call === null) return;
    dismissCall(call);
  }, [currentCall, dismissCall]);

  const openOrder = useCallback((): void => {
    const call = currentCall;
    if (call === null) return;
    openOrderForCall(call);
  }, [currentCall, openOrderForCall]);

  const value = useMemo<IncomingCallContextValue>(
    () => ({ currentCall, dismiss, openOrder }),
    [currentCall, dismiss, openOrder],
  );

  return (
    <IncomingCallContext.Provider value={value}>
      {children}
      {currentCall !== null && (
        /* key = kayıt id'si + çağrı saati → HER yeni çağrıda popup yeniden
           kurulur (aynı numara ısrarla arasa bile ekranda görünür bir değişim
           olur). Aynı kayıt id'siyle gelen tekrar çağrılarda receivedAt farklı
           olduğu için remount yine gerçekleşir. Handler'lar o anki çağrıyı
           taşır — araya giren yeni çağrı yanlışlıkla kapatılmaz. */
        <IncomingCallPopup
          key={`${currentCall.callLogId}:${currentCall.receivedAt}`}
          call={currentCall}
          onDismiss={() => dismissCall(currentCall)}
          onOpenOrder={() => openOrderForCall(currentCall)}
        />
      )}
    </IncomingCallContext.Provider>
  );
}
