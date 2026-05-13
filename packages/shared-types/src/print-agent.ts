import { z } from 'zod';

/**
 * ADR-004 §6 Soru #6 — Print Agent ↔ Cloud 4 endpoint sözleşmesi.
 *
 * Phase 3 PR-1 scope (decisions.md ADR-004 §Phase 3 PR-1 Scope Kilidi):
 *   - Runtime'da yalnız `JobsNextResponseSchema` ve `PrintJobSchema`
 *     kullanılır (GET /print/v1/jobs/next long-poll endpoint).
 *   - Diğer 3 schema (`AgentRegister*`, `AgentRefresh*`, `JobResult*`)
 *     iskelet olarak burada tanımlanır — gerçek auth + result callback
 *     Phase 4+ PR'larında implemente edilir. Şimdi tanımlanması, Agent
 *     skeleton'ın import edebilmesi + tipi tek noktada tutmak için.
 *
 * Tüm string alanlar UTF-8; `payload` JSONB (Phase 4+ byte stream
 * eklenecek — ADR-004 §4 cloud render).
 */

/**
 * Print job durum çarkı — DB enum (`print_job_status`,
 * `packages/db/migrations/000_init.sql`) ile birebir aynı.
 *
 * ADR-004 §Phase 3 PR-1 Scope Kilidi (Session 62) — enum drift kararı:
 * DB enum esas alındı. ADR-004 §3 metnindeki state machine açıklaması
 * gelecek amendment'ta DB'ye göre düzeltilecek (`retry` status'u §3'te
 * yoktu, DB'de var). Phase 3 PR-1 yalnız `queued → printing` transition'ını
 * kullanır; `retry / failed / cancelled / success` Phase 4+ akışına ait.
 */
export const PrintJobStatusSchema = z.enum([
  'queued',
  'printing',
  'success',
  'failed',
  'cancelled',
  'retry',
]);
export type PrintJobStatus = z.infer<typeof PrintJobStatusSchema>;

/**
 * Print job DTO — DB satırının HTTP'e dönen şekli. `tenantId` camelCase
 * (HTTP convention); DB sütunu `tenant_id` snake_case. `payload` opaque
 * JSON (UI / Agent printer transport bunu yorumlayacak — Phase 4+).
 *
 * `attempts` (ADR-004 Amendment 1, Session 63 PR-2): job'un kaç kez
 * denendiği sayacı. `printing → failed` transition'ında +1; `queued →
 * printing` ve `printing → success` transition'larında DEĞİŞMEZ. DB
 * CHECK constraint 0..100 (sonsuz retry guard).
 */
export const PrintJobSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  status: PrintJobStatusSchema,
  attempts: z.number().int().min(0).max(100),
  payload: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PrintJob = z.infer<typeof PrintJobSchema>;

/**
 * GET /print/v1/jobs/next?wait=N
 *
 *   - 200 + JobsNextResponseSchema → kuyrukta job vardı, atomik claim
 *     edildi (status: queued → printing). Agent bu job'u işler.
 *   - 204 No Content                → kuyruk boş + ?wait süresi doldu.
 *
 * Agent davranışı: 204 alınca hemen yeniden poll'a girer (sıfır gecikme).
 * 200 alınca payload'ı işler, ardından (Phase 4+) sonucu
 * POST /print/v1/jobs/:id/result ile bildirir. Phase 3 PR-1'de Agent
 * yalnız job'u alıp log'lar.
 */
export const JobsNextResponseSchema = z.object({
  job: PrintJobSchema,
});
export type JobsNextResponse = z.infer<typeof JobsNextResponseSchema>;

/**
 * POST /print/v1/agent/register — Phase 4+ implementasyon.
 * Agent ilk açılışta apiKey + cihaz parmak izi gönderir, karşılığında
 * uzun ömürlü refresh token + kısa ömürlü access token alır.
 */
export const AgentRegisterRequestSchema = z.object({
  apiKey: z.string().min(1),
  deviceFingerprint: z.string().min(1),
});
export type AgentRegisterRequest = z.infer<typeof AgentRegisterRequestSchema>;

export const AgentRegisterResponseSchema = z.object({
  agentId: z.string().uuid(),
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type AgentRegisterResponse = z.infer<typeof AgentRegisterResponseSchema>;

/**
 * POST /print/v1/agent/refresh — Phase 4+ implementasyon.
 * Access token süresi dolunca refresh token ile yenilenir; refresh token
 * rotate edilir (one-time-use).
 */
export const AgentRefreshRequestSchema = z.object({
  refreshToken: z.string(),
});
export type AgentRefreshRequest = z.infer<typeof AgentRefreshRequestSchema>;

export const AgentRefreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type AgentRefreshResponse = z.infer<typeof AgentRefreshResponseSchema>;

/**
 * POST /print/v1/jobs/:id/result — Phase 3 PR-2 (ADR-004 Amendment 1).
 * Agent yazdırma denemesi sonucunu bildirir.
 *
 * Server state machine (Amendment 1):
 *   - success → terminal, attempts DEĞİŞMEZ
 *   - failed  → attempts+1; <3 ise retry, ≥3 ise cancelled (terminal)
 *
 * `errorText` opsiyonel; printer / OS hatası özeti (PII içeremez —
 * müşteri verisi değil). Phase 4+'da audit log'a yazılacak.
 *
 * Idempotency: aynı `jobId` + aynı terminal status (success/cancelled)
 * ikinci kez POST'lanırsa state DEĞİŞMEZ, mevcut hâl 200 ile döner.
 *
 * Yanıt: 200 + `{ job: PrintJob }` (güncel status + attempts).
 * Hatalar:
 *   - 404 PRINT_JOB_NOT_FOUND
 *   - 400 PRINT_JOB_NOT_IN_PRINTING_STATE
 *   - 400 VALIDATION_ERROR (body schema mismatch)
 */
export const JobResultRequestSchema = z.object({
  status: z.enum(['success', 'failed']),
  errorText: z.string().optional(),
});
export type JobResultRequest = z.infer<typeof JobResultRequestSchema>;

/**
 * POST /print/v1/jobs/:id/result başarılı yanıt zarfı — `GET
 * /jobs/next` ile aynı şekilde tek `job` alanı taşır. Agent skeleton
 * tarafında tek bir parser ile her iki endpoint'in payload'ı
 * decode edilebilir.
 */
export const JobResultResponseSchema = z.object({
  job: PrintJobSchema,
});
export type JobResultResponse = z.infer<typeof JobResultResponseSchema>;
