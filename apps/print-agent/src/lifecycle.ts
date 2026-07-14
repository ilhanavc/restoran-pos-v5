/**
 * Print-agent ağ-backoff (P11-A-03) + süreç yaşam-döngüsü (P11-B-02) yardımcıları.
 *
 * index.ts'ten ayrık tutulur: index.ts modül-seviyesinde `main()` çağırır →
 * doğrudan import test'i tetikler. Bu saf/izole fonksiyonlar ayrı modülde
 * birim-test edilebilir kalır (main() yan-etkisi olmadan).
 */

/** P11-A-03 — ağ-hatası backoff sınırları (hot-loop önleme). */
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 15000;

/** setTimeout tabanlı await'lenebilir gecikme. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * P11-A-03 — ardışık ağ/sunucu hatasında artan backoff: 0→1s→3s→9s→15s(cap).
 * `prevMs <= 0` (başarı sonrası reset) → taban. Cloud kesintisinde hot-loop
 * (CPU %100 + saniyelik log-flood → C: disk riski) yerine kademeli geri çekilme.
 */
export function computeBackoff(prevMs: number): number {
  const next = prevMs <= 0 ? BACKOFF_BASE_MS : prevMs * 3;
  return Math.min(next, BACKOFF_MAX_MS);
}

/**
 * P11-B-02 — süreç yaşam-döngüsü handler'ları: SIGTERM/SIGINT'te temiz exit(0),
 * yakalanmamış hata/rejection'da temiz mesaj + exit(1) (nssm restart, ham-stack
 * yerine). Amaç: crash-loop'u kapatmak, ham-stack yerine operatör-mesajı.
 * NOT: in-flight yazımı DRAIN etmez (anında exit); veri-kaybı server-side
 * lazy-reclaim ile önlenir, ancak byte'lar yazıcıya gitmişken kesilirse reclaim
 * çift-baskı üretebilir — bu print-once idempotency (P11-A-02) ayrı ADR kapsamı.
 */
export function registerLifecycleHandlers(): void {
  const shutdown = (signal: string): void => {
    console.log(`[print-agent] ${signal} alındı — kapanılıyor.`);
    process.exit(0);
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('unhandledRejection', (reason) => {
    console.error(
      '[print-agent] unhandledRejection:',
      reason instanceof Error ? reason.message : reason,
    );
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    console.error('[print-agent] uncaughtException:', err.message);
    process.exit(1);
  });
}
