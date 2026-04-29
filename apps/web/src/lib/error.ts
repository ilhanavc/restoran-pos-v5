import { AxiosError } from 'axios';
import i18n from 'i18next';

/**
 * Backend error envelope (ADR-006 §2):
 *   { error: { code, message_key, details? } }
 */
interface ErrorEnvelope {
  error?: {
    code?: string;
    message_key?: string;
    details?: unknown;
  };
}

/**
 * Extracts a localized, user-facing message from an unknown error.
 * Lookup order:
 *   1. error.{CODE} from registry (preferred)
 *   2. message_key (server-provided i18n key)
 *   3. Network error fallback (no response)
 *   4. Generic `error._unknown`
 *
 * Never returns raw stack traces or backend messages — all UI text passes through i18n.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    if (!error.response) {
      return i18n.t('auth.error.networkError');
    }
    const data = error.response.data as ErrorEnvelope | undefined;
    const code = data?.error?.code;
    if (code) {
      const codeKey = `error.${code}`;
      if (i18n.exists(codeKey)) return i18n.t(codeKey);
    }
    const messageKey = data?.error?.message_key;
    if (messageKey && i18n.exists(messageKey)) {
      return i18n.t(messageKey);
    }
  }
  return i18n.t('error._unknown');
}
