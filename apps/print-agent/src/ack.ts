/**
 * ADR-004 Amendment 6 — Bölüm B (Print-Once Idempotency, Tier 1: B2/B3).
 *
 * Kök neden (Derin Denetim P11-A-01/A-02): `reportResult` fetch'i
 * try/catch'sizdi → başarılı fiziksel baskıdan SONRA geçici ağ hatasında
 * başarı-ack'i kayboluyordu → job 'printing'de kalıp RECLAIM_STALE_SECONDS
 * sonrası reclaim ediliyordu → AYNI FİŞ İKİNCİ KEZ BASILIYORDU.
 *
 * Bu modül ack denemesini sınırlı in-process backoff-retry ile sarar (B2).
 * At-least-once KORUNUR (B1): bütçe bitince vazgeçilir ve reclaim devralır
 * (basmama > çift-basma; kaçırılan mutfak fişi = kaçırılan yemek). Disk-kalıcı
 * ack (Tier 2) BİLİNÇLİ ertelendi (B4).
 *
 * index.ts'ten ayrık: index.ts modül-seviyesinde `main()` çağırır → doğrudan
 * import test'i tetikler. Bu saf fonksiyonlar burada birim-test edilebilir
 * kalır (lifecycle.ts paterni).
 */
import { computeBackoff, sleep } from './lifecycle.js';

/**
 * B3 — reclaim penceresi koordinasyonu: worst-case ack bütçesi
 * `ACK_MAX_ATTEMPTS × ACK_FETCH_TIMEOUT_MS + backoff uykuları (1+3+9s)`
 * = 4×10s + 13s = 53s. Transport timeoutMs default 10s (printer/config.ts)
 * eklenince claim→ack-tamam ≈ 63s < RECLAIM_STALE_SECONDS 90s default
 * (apps/api/src/routes/print-jobs.ts) — 27s marj. Bu sabitler büyütülürse
 * ack.test.ts'teki B3 bütçe testi KIRILIR (bilinçli koordinasyon guard'ı).
 */
export const ACK_MAX_ATTEMPTS = 4;
/** Tek ack fetch denemesinin üst sınırı (AbortSignal.timeout). */
export const ACK_FETCH_TIMEOUT_MS = 10_000;

/**
 * Tek ack denemesinin sonucu:
 * - 'acked'     → sunucu yanıtladı, sonuç işlendi (2xx; idempotent no-op dahil)
 * - 'retriable' → ağ hatası / 5xx / 408 / 429 — tekrar denemeye değer
 * - 'fatal'     → deterministik 4xx — aynı POST aynı cevabı verir, bütçe yakma
 */
export type AckAttemptOutcome = 'acked' | 'retriable' | 'fatal';

/** ackWithRetry nihai sonucu — 'gave-up' = reclaim devralacak (at-least-once). */
export type AckResult = 'acked' | 'gave-up';

/**
 * HTTP yanıt kodunu retriable/fatal olarak sınıflandırır. 5xx + 408 + 429
 * geçicidir; kalan 4xx deterministiktir (400 PRINT_JOB_NOT_IN_PRINTING_STATE,
 * 404 PRINT_JOB_NOT_FOUND, 401 auth — refresh main-loop poll yolunda yapılır,
 * ack içinde retry bütçeyi boşa yakar).
 */
export function classifyAckHttpStatus(status: number): 'retriable' | 'fatal' {
  if (status >= 500 || status === 408 || status === 429) {
    return 'retriable';
  }
  return 'fatal';
}

/**
 * B2 — ack denemesini sınırlı backoff-retry ile sarar. Sözleşme:
 * - ASLA reject etmez (ack hatası poll döngüsünü öldüremez).
 * - `attempt` fırlatırsa 'retriable' sayılır (defense-in-depth; asıl
 *   sınıflandırmayı attempt kendi yapar).
 * - 'fatal'de anında vazgeçer; 'retriable'da computeBackoff (1→3→9s) ile
 *   bekleyip yeniden dener; bütçe (ACK_MAX_ATTEMPTS) bitince 'gave-up'.
 * - `sleepFn` test için inject edilebilir.
 */
export async function ackWithRetry(
  attempt: () => Promise<AckAttemptOutcome>,
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<AckResult> {
  let backoffMs = 0;
  for (let attemptNo = 1; attemptNo <= ACK_MAX_ATTEMPTS; attemptNo += 1) {
    let outcome: AckAttemptOutcome;
    try {
      outcome = await attempt();
    } catch {
      outcome = 'retriable';
    }
    if (outcome === 'acked') {
      return 'acked';
    }
    if (outcome === 'fatal') {
      return 'gave-up';
    }
    if (attemptNo < ACK_MAX_ATTEMPTS) {
      backoffMs = computeBackoff(backoffMs);
      await sleepFn(backoffMs);
    }
  }
  return 'gave-up';
}
