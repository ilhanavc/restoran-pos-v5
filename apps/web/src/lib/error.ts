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
 *   1. error.{CODE} from registry — **the contract** (ADR-006 §2 Amd, S141)
 *   2. message_key (server-provided i18n key) — pratikte HİÇ İSABET ETMEZ
 *   3. Network error fallback (no response)
 *   4. Generic `error._unknown`
 *
 * ⚠️ 2. adım ölü bir daldır: sunucunun gönderdiği `message_key` değerlerinin
 * (98 adet) hiçbiri bu sözlükte YOK — ölçüldü, S141. Dal savunma amaçlı duruyor
 * ama **yeni bir koda metin eklerken `error.{CODE}` yazılmalı**; yalnız sunucu
 * tarafındaki `AUTH_MESSAGE_KEYS`'e girdi eklemek kullanıcıya metin göstermez,
 * sessizce 4. adıma ("Beklenmeyen hata oluştu") düşer.
 *
 * ℹ️ Kullanıcı yönetimi ekranı bu fonksiyonu KULLANMAZ; kendi namespace'inde
 * `admin.users.errors.{CODE}` arar (`UsersPage.tsx`). Yeni bir `/users` hata
 * kodunun metni oraya yazılır.
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
