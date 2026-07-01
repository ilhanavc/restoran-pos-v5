/**
 * UUID v4 for the payment Idempotency-Key (ADR-014 §10.10 + ADR-027 Faz A).
 *
 * Pure JS (Math.random) — deliberately NO native crypto module: the waiter app
 * runs under Expo Go with no native deps (ADR-025 K3). This value is a
 * replay-dedup token, NOT a secret or a cryptographic nonce — its only job is to
 * be unique per payment attempt so a retried POST /payments collapses to a
 * single charge server-side (the backend returns the existing payment on a
 * duplicate key). Collision risk at POS volumes (a few payments/minute on one
 * device) is negligible. Format matches `z.string().uuid()` (RFC 4122 v4).
 */
export function genIdempotencyKey(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    if (c === 'y') {
      // RFC 4122 variant nibble: one of 8, 9, a, b.
      return (8 + Math.floor(Math.random() * 4)).toString(16);
    }
    return Math.floor(Math.random() * 16).toString(16);
  });
}
