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
 * Print job iş türü — `payload.kind` alanının değer kümesi. Enqueue tarafı:
 * `enqueue-kitchen-job` → 'kitchen' (`:125`), `enqueue-bill-job` → 'bill'
 * (`:93`). ADR-032 ikincil yazıcı yönlendirmesi: claim filtresi
 * (`GET /jobs/next?kind=`) + agent config (`jobKinds`) bu enum'a göre
 * doğrulanır. DB'de ayrı kolon DEĞİL — `payload` JSONB içindeki discriminator
 * (migration yok, Design B).
 */
export const PrintJobKindSchema = z.enum(['kitchen', 'bill', 'grill']);
export type PrintJobKind = z.infer<typeof PrintJobKindSchema>;

/**
 * Mutfak istasyonları — `PrintJobKind`'ın **kağıt-fişi-mutfağa-basan** alt kümesi
 * (ADR-032 Amendment 1 K5). `bill` KASITLI olarak dışarıdadır.
 *
 * Enqueue, `categories.print_station` değerini bu alt kümeye karşı doğrular;
 * `PrintJobKindSchema`'ya karşı DEĞİL. Gerekçe: `'bill'` enum'un geçerli
 * üyesidir, dolayısıyla `PrintJobKindSchema.safeParse('bill')` başarılı olur ve
 * `print_station='bill'` yazım hatası fallback'i TETİKLEMEZ → mutfak fişi kasa
 * yazıcısından çıkar (v3'ün tip-güvensiz yönlendirme hatasının aynısı). Alt küme
 * ile bu yapısal olarak imkânsızdır.
 *
 * Yeni fiziksel mutfak istasyonu eklenirse: `PrintJobKindSchema` + bu dizi
 * birlikte genişletilir (agent exe rebuild gerekir — ADR-032 Amd1 K7).
 */
export const KITCHEN_STATION_KINDS = ['kitchen', 'grill'] as const;
export type KitchenStationKind = (typeof KITCHEN_STATION_KINDS)[number];

/** `categories.print_station` ham değerinin geçerli bir mutfak istasyonu olup olmadığı. */
export function isKitchenStation(value: unknown): value is KitchenStationKind {
  return (
    typeof value === 'string' && (KITCHEN_STATION_KINDS as readonly string[]).includes(value)
  );
}

/** Atanmamış/bilinmeyen/tip-dışı `print_station` değerlerinin düştüğü taban istasyon. */
export const DEFAULT_KITCHEN_STATION: KitchenStationKind = 'kitchen';

/**
 * Print job DTO — DB satırının HTTP'e dönen şekli. `tenantId` camelCase
 * (HTTP convention); DB sütunu `tenant_id` snake_case. `payload` opaque
 * JSON (UI / Agent printer transport bunu yorumlayacak — Phase 4+).
 *
 * `attempts` (ADR-004 Amendment 1, Session 63 PR-2): job'un kaç kez
 * denendiği sayacı. `printing → failed` transition'ında +1; `queued →
 * printing` ve `printing → success` transition'larında DEĞİŞMEZ. DB
 * CHECK constraint 0..100 (sonsuz retry guard).
 *
 * `lastError` (ADR-004 Amendment 13): agent'ın `errorText` ile bildirdiği
 * son hata metni. Yalnız `errorText` geldiğinde üzerine yazılır; `success`
 * sonrası önceki değer KORUNUR (tarihçe yok). Eski agent exe'leri bu alanı
 * yok sayar (zod `safeParse` bilinmeyen alanı görmezden gelir) — geriye
 * dönük uyumlu, yeni bir agent build'i GEREKMEZ.
 */
export const PrintJobSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  status: PrintJobStatusSchema,
  attempts: z.number().int().min(0).max(100),
  payload: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastError: z.string().nullable(),
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
 * Ajan binary sürümünün kabul edilen biçimi — ADR-044 K4.
 *
 * Kaynak `apps/print-agent/package.json` → `src/version.ts` → WiX
 * `Package/@Version`; üçü de `major.minor.patch` (ör. `0.0.5`). Ön ek/son ek
 * (`v0.0.5`, `0.0.5-beta`) KABUL EDİLMEZ: alan salt gözlemdir ve
 * `PRINT_AGENT_EXPECTED_VERSION` ile **birebir string** karşılaştırılır —
 * biçim serbest bırakılırsa aynı sürüm iki yazımla iki farklı değer olur ve
 * "bayat" rozeti yanlış yanar.
 */
export const AGENT_VERSION_RE = /^\d+\.\d+\.\d+$/;

/**
 * Ajan sürümü. `.max(20)` üst sınırı DB kolonu `TEXT` olduğu için
 * uygulama tarafında konur (regex zaten dar; sınır savunma amaçlı).
 */
export const AgentVersionSchema = z
  .string()
  .regex(AGENT_VERSION_RE)
  .max(20);

/**
 * `GET /print/v1/jobs/next?agentVersion=` parse yardımcısı — ADR-044 K4.
 *
 * 🔴 **Geçersiz/eksik değer `null` döner, HATA FIRLATMAZ** ve bu
 * `parseKindFilter`'ın 400'lü davranışından BİLİNÇLİ olarak farklıdır:
 * `kind` claim'in yüklemini belirler (yanlışsa yanlış fiş basılır), sürüm ise
 * yalnız ekranda bir satır. Gözlem alanı yüzünden baskı poll'unu düşürmek
 * ölçülen arıza sınıfını (ajan eski build'de donmuş) düzeltmek için eklenen
 * alanın kendisini arıza sebebi yapardı.
 *
 * Tekrarlı param (`?agentVersion=a&agentVersion=b`) → Express dizi verir;
 * ilk değer alınır (ajan tek değer gönderir, dizi yalnız elle/kötü niyetli
 * çağrıda oluşur).
 */
export function parseAgentVersionParam(raw: unknown): string | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') return null;
  const parsed = AgentVersionSchema.safeParse(first.trim());
  return parsed.success ? parsed.data : null;
}

/**
 * POST /print/v1/agent/register — Phase 4+ implementasyon.
 * Agent ilk açılışta apiKey + cihaz parmak izi gönderir, karşılığında
 * uzun ömürlü refresh token + kısa ömürlü access token alır.
 *
 * `agentVersion` (ADR-044 K4) **opsiyonel**: taze kurulumda sürüm ilk
 * poll'dan önce görünsün diye gövdede de taşınır. Alanı göndermeyen eski exe
 * aynen 200 alır (geriye dönük uyumlu — yeni agent build'i register için
 * ŞART DEĞİL).
 */
export const AgentRegisterRequestSchema = z.object({
  apiKey: z.string().min(1),
  deviceFingerprint: z.string().min(1),
  /**
   * 🔴 **Biçim BURADA doğrulanmaz — bilerek.** Önceki hâli
   * `AgentVersionSchema.optional()` idi ve bu, biçimsiz bir sürüm dizgesi
   * gönderen bir ajanın **register'ının tamamını 400'e** düşürüyordu: yani
   * ajan **hiç kaydolamıyordu** ve o yazıcı susuyordu. Bir **gözlem alanının**
   * bir **auth yolunu** kapatması, K4'ün kendi gerekçesiyle çelişir (ADR-044
   * K4: *"gözlem alanı yüzünden baskı poll'unu düşürmek, eklenen alanın
   * kendisini arıza sebebi yapar"*) — aynı muhakeme gövde için de geçerli,
   * çünkü register fail-closed'ın en sivri ucudur.
   *
   * Bu yüzden şema yalnız **sınır** koyar; biçim normalizasyonu tek noktada,
   * `parseAgentVersionParam` ile yapılır (sorgu parametresiyle **aynı**
   * yardımcı) ve uymayan değer `null`'a düşer. İki kanal için iki kural
   * tutmak, ileride birinin diğerinden ayrışmasının garantisiydi.
   */
  agentVersion: z.string().max(40).optional(),
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
 * müşteri verisi değil). ADR-004 Amendment 13'ten beri `print_jobs.last_error`
 * kolonuna persist edilir. `.max(500)` — sürücü/spooler hata mesajları
 * teorik olarak sınırsız uzunlukta olabilir (db-migration-guard önerisi);
 * 500 karakter tanı için fazlasıyla yeterli.
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
  errorText: z.string().max(500).optional(),
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
