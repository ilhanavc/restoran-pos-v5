import { useQueryClient } from '@tanstack/react-query';
import type {
  CallerStatusChangedPayload,
  IncomingCallEvent,
} from '@restoran-pos/shared-types';
import { useSocketEvent } from '../../../lib/socket';
import { CALL_LOGS_KEY } from '../api/calls';

/**
 * `caller.incoming` + `caller.status_changed` event aboneliği (ADR-016 §11).
 *
 * - incoming → provider'a payload (popup tetikler)
 * - status_changed → query cache invalidate (recent log feed güncel)
 */
export function useIncomingCallSocket(
  onIncoming: (payload: IncomingCallEvent) => void,
): void {
  const qc = useQueryClient();

  useSocketEvent<IncomingCallEvent>('caller.incoming', (payload) => {
    onIncoming(payload);
    void qc.invalidateQueries({ queryKey: CALL_LOGS_KEY });
  });

  useSocketEvent<CallerStatusChangedPayload>('caller.status_changed', () => {
    void qc.invalidateQueries({ queryKey: CALL_LOGS_KEY });
  });
}
