import { hostname } from 'node:os';
import { Buffer } from 'node:buffer';
import jwt from 'jsonwebtoken';
import {
  AgentRegisterResponseSchema,
  AgentRefreshResponseSchema,
  JobsNextResponseSchema,
  type JobsNextResponse,
} from '@restoran-pos/shared-types';
import { loadPrinterConfig, type PrinterConfig } from './printer/config.js';
import { sendToTcpPrinter } from './printer/tcp-transport.js';

/**
 * Print Agent — ADR-004 §2 + §6 Soru #6.
 *
 * Phase 3 PR-3b scope (decisions.md ADR-004 §Phase 3 PR-3b Scope Kilidi):
 *   - Boot'ta `POST /print/v1/agent/register` ile apiKey + deviceFingerprint
 *     karşılığında accessToken / refreshToken alır (in-memory).
 *   - Access token expiry 5 dk yaklaşınca `POST /print/v1/agent/refresh` ile
 *     yeniler; refresh fail → otomatik re-register.
 *   - Long-poll `GET /print/v1/jobs/next` artık `Authorization: Bearer …`
 *     header'ı ile çağrılır (X-Tenant-Id KALDIRILDI — tenant register'dan
 *     öğrenilir).
 *
 * Phase 3 PR-5a scope (BU PR — ADR-004 §5):
 *   - Printer config yükleme (`./printer/config.ts`): %PROGRAMDATA%/json
 *     dosyası veya env compose (PRINT_AGENT_PRINTER_HOST + _PORT).
 *   - TCP 9100 transport (`./printer/tcp-transport.ts`): pollOnce job
 *     `payload.bytesBase64` alanını decode edip printer'a yollar; başarı
 *     `success`, hata `failed + errorText` olarak server'a raporlanır.
 *   - USB transport PR-5b'de (kullanıcı eşliği lokal donanım).
 *
 * Yapılacak (Phase 4+):
 *   - USB transport (PR-5b)
 *   - Cloud render (PR-4)
 *   - MSI installer + Windows service + token file persist (PR-6)
 *
 * Env değişkenleri:
 *   - PRINT_AGENT_API_URL              (default: http://localhost:4001)
 *   - PRINT_AGENT_API_KEY              (zorunlu, format `pk_xxxxxxxx_*`)
 *   - PRINT_AGENT_DEVICE_FINGERPRINT   (default: `${hostname}-${platform}`)
 *   - PRINT_AGENT_LONGPOLL_S           (default: 25, server üst sınırı)
 *
 * NOT: Print Agent kullanıcıya görünen UI yok — sadece log. Kullanıcıya
 * gösterilecek hata mesajları (Phase 4+) i18n key'lerle gelir (UI tarafı
 * Phase 5'te entegre olur).
 */

const DEFAULT_API_URL = 'http://localhost:4001';
const DEFAULT_LONGPOLL_SECONDS = 25;
/** Access token expiry'den kaç saniye önce refresh tetiklenir. */
const REFRESH_BUFFER_SECONDS = 300;

interface AgentConfig {
  apiUrl: string;
  apiKey: string;
  deviceFingerprint: string;
  longPollSeconds: number;
}

/**
 * Boot register / refresh sonucu — disk'e yazılmaz (Phase 4+ MSI ile
 * birlikte token file persist gelir). Agent restart'ta yeniden register.
 */
interface AgentSession {
  accessToken: string;
  refreshToken: string;
  agentId: string;
  /** JWT `exp` claim (unix seconds). Decode-only (secret yok client'ta). */
  accessExp: number;
}

function loadConfig(): AgentConfig {
  const apiUrl = process.env['PRINT_AGENT_API_URL'] ?? DEFAULT_API_URL;
  const apiKey = process.env['PRINT_AGENT_API_KEY'] ?? '';
  if (apiKey === '') {
    console.error(
      '[print-agent] PRINT_AGENT_API_KEY env değişkeni zorunlu (format: pk_xxxxxxxx_*).',
    );
    process.exit(1);
  }
  const deviceFingerprint =
    process.env['PRINT_AGENT_DEVICE_FINGERPRINT'] ??
    `${hostname()}-${process.platform}`;
  const longPollRaw = process.env['PRINT_AGENT_LONGPOLL_S'];
  const longPollSeconds =
    longPollRaw === undefined || longPollRaw === ''
      ? DEFAULT_LONGPOLL_SECONDS
      : Math.max(0, Math.min(25, Number(longPollRaw) || DEFAULT_LONGPOLL_SECONDS));
  return { apiUrl, apiKey, deviceFingerprint, longPollSeconds };
}

/**
 * JWT'yi decode et (verify değil — secret yok client'ta). Server zaten
 * sign etmiş; client sadece `exp` claim'ini freshness check için okur.
 * Decode hatası veya `exp` yoksa 0 dönülür → ilk poll'da stale algılanıp
 * refresh tetiklenir (defensive default).
 */
function decodeAccessExp(accessToken: string): number {
  try {
    const decoded = jwt.decode(accessToken);
    if (decoded === null || typeof decoded !== 'object') {
      return 0;
    }
    const exp = (decoded as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp : 0;
  } catch {
    return 0;
  }
}

/**
 * Boot register — apiKey + deviceFingerprint → accessToken + refreshToken.
 * Başarısızsa hata fırlatır (main loop boot'ta dururup retry'a girer).
 */
async function register(cfg: AgentConfig): Promise<AgentSession> {
  const res = await fetch(`${cfg.apiUrl}/print/v1/agent/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: cfg.apiKey,
      deviceFingerprint: cfg.deviceFingerprint,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<body okunamadı>');
    throw new Error(
      `[print-agent] register failed HTTP ${res.status.toString()}: ${text}`,
    );
  }
  const parsed = AgentRegisterResponseSchema.parse(await res.json());
  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    agentId: parsed.agentId,
    accessExp: decodeAccessExp(parsed.accessToken),
  };
}

/**
 * Refresh — refreshToken ile yeni access+refresh çifti alır. Server-side
 * refresh token rotate edilir (one-time-use); client her refresh'te yeni
 * pair alır. Refresh fail (HTTP !ok) → otomatik re-register (refresh token
 * revoke veya expired olduğunda kurtarma yolu).
 */
async function refresh(
  cfg: AgentConfig,
  session: AgentSession,
): Promise<AgentSession> {
  const res = await fetch(`${cfg.apiUrl}/print/v1/agent/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  if (!res.ok) {
    console.warn(
      `[print-agent] refresh failed HTTP ${res.status.toString()}, re-registering`,
    );
    return register(cfg);
  }
  const parsed = AgentRefreshResponseSchema.parse(await res.json());
  return {
    agentId: session.agentId,
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    accessExp: decodeAccessExp(parsed.accessToken),
  };
}

/**
 * Access token expiry < 5 dk kala stale sayılır → main loop refresh
 * tetikler. Clock skew toleransı: server clock farkı 1-2 sn olabilir,
 * 5 dk buffer rahat tolere eder.
 */
function isAccessTokenStale(session: AgentSession): boolean {
  const now = Math.floor(Date.now() / 1000);
  return session.accessExp - now < REFRESH_BUFFER_SECONDS;
}

/**
 * Job tamamlanınca server'a sonuç bildirir (Phase 3 PR-3b'de her zaman
 * success — gerçek printer transport PR-5'te). Hata HTTP'leri log'lanır
 * ama döngü devam eder (idempotency: aynı jobId+success ikinci kez
 * gönderilirse server mevcut hâli döner — JobResultResponseSchema doc'u).
 */
async function reportResult(
  cfg: AgentConfig,
  session: AgentSession,
  jobId: string,
  status: 'success' | 'failed',
  errorText?: string,
): Promise<void> {
  const res = await fetch(`${cfg.apiUrl}/print/v1/jobs/${jobId}/result`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({
      status,
      ...(errorText !== undefined ? { errorText } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<body okunamadı>');
    console.error(
      `[print-agent] result POST failed HTTP ${res.status.toString()}: ${text}`,
    );
    return;
  }
  console.log(
    `[print-agent] result POST OK: jobId=${jobId} status=${status}`,
  );
}

/**
 * Tek poll iterasyonu. Hata fırlatmaz — tüm hatalar log'a, döngü
 * devam eder. Bu sayede ağ kesintisi → restart döngüsü olmaz; agent
 * bağlantı geri gelene kadar log'lar ve poll'lamayı sürdürür.
 *
 * Dönüş: yeni AgentSession (401 race condition'da token refresh edilmiş
 * olabilir; çağıran main loop session'ı günceller). 401 → tek seferlik
 * refresh denenir, sonra poll bir sonraki iterasyonda tekrar denenecek.
 *
 * PR-5a: `printerConfig` parametresi alır; job alındığında payload
 * `bytesBase64` decode edilip TCP printer'a yollanır.
 */
async function pollOnce(
  cfg: AgentConfig,
  session: AgentSession,
  printerConfig: PrinterConfig,
): Promise<AgentSession> {
  const url = `${cfg.apiUrl}/print/v1/jobs/next?wait=${cfg.longPollSeconds.toString()}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
  } catch (err) {
    console.error(
      `[print-agent] fetch hatası (${url}):`,
      err instanceof Error ? err.message : err,
    );
    return session;
  }

  // 401 race condition: refresh buffer 5 dk yetersiz kaldıysa
  // (örn. saat senkron sorunu) token refresh edip bir sonraki
  // iterasyonda tekrar deneriz. Burada tekrar poll yapmıyoruz — main
  // loop sıradaki iterasyonu çalıştıracak.
  if (response.status === 401) {
    console.warn('[print-agent] 401 alındı, token refresh deneniyor');
    try {
      return await refresh(cfg, session);
    } catch (err) {
      console.error(
        '[print-agent] 401 sonrası refresh hatası:',
        err instanceof Error ? err.message : err,
      );
      return session;
    }
  }

  if (response.status === 204) {
    console.log('[print-agent] kuyruk boş (204)');
    return session;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '<body okunamadı>');
    console.error(
      `[print-agent] HTTP ${response.status.toString()}: ${text}`,
    );
    return session;
  }

  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch (err) {
    console.error(
      '[print-agent] JSON parse hatası:',
      err instanceof Error ? err.message : err,
    );
    return session;
  }

  const parsed = JobsNextResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    console.error(
      '[print-agent] yanıt şema uyuşmuyor:',
      parsed.error.issues,
    );
    return session;
  }

  const job: JobsNextResponse['job'] = parsed.data.job;
  console.log(
    `[print-agent] job alındı: id=${job.id} status=${job.status} createdAt=${job.createdAt}`,
  );

  // PR-5a: payload.bytesBase64 → decode → TCP printer.
  // `payload` z.record(z.unknown()) — alan tipini runtime'da kontrol et.
  // Malformed payload (alan yok / string değil) → `failed + errorText`.
  const payloadBytes = job.payload['bytesBase64'];
  if (typeof payloadBytes !== 'string' || payloadBytes === '') {
    const reason = 'payload.bytesBase64 missing or empty';
    console.error(`[print-agent] job ${job.id} ${reason}`);
    await reportResult(cfg, session, job.id, 'failed', reason);
    return session;
  }

  let bytes: Uint8Array;
  try {
    // base64 decode → Buffer → Uint8Array view (zero-copy).
    const buf = Buffer.from(payloadBytes, 'base64');
    bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (err) {
    const reason = `base64 decode failed: ${
      err instanceof Error ? err.message : String(err)
    }`;
    console.error(`[print-agent] job ${job.id} ${reason}`);
    await reportResult(cfg, session, job.id, 'failed', reason);
    return session;
  }

  try {
    await sendToTcpPrinter(bytes, printerConfig);
    console.log(
      `[print-agent] printer OK jobId=${job.id} bytes=${bytes.length.toString()}`,
    );
    await reportResult(cfg, session, job.id, 'success');
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[print-agent] printer fail jobId=${job.id}: ${errMsg}`);
    await reportResult(cfg, session, job.id, 'failed', errMsg);
  }
  return session;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  // Printer config boot'ta yüklenir; eksik/geçersizse Error fırlar ve
  // process exit eder (intentional fail-fast: register'a girmeden dur).
  const printerConfig = loadPrinterConfig();
  console.log(
    `[print-agent] başlatıldı (api=${cfg.apiUrl}, fingerprint=${cfg.deviceFingerprint}, longPoll=${cfg.longPollSeconds.toString()}s, printer=${printerConfig.host}:${printerConfig.port.toString()})`,
  );
  let session = await register(cfg);
  console.log(`[print-agent] register OK: agentId=${session.agentId}`);

  // Long-poll döngüsü — server zaten beklemeyi yapar; client tarafı
  // hemen yeniden poll'a girer. Token expiry yaklaşınca refresh.
  for (;;) {
    if (isAccessTokenStale(session)) {
      console.log('[print-agent] token stale, refreshing');
      try {
        session = await refresh(cfg, session);
      } catch (err) {
        console.error(
          '[print-agent] refresh hatası, döngü devam:',
          err instanceof Error ? err.message : err,
        );
        // Refresh fail (network) → bir sonraki iterasyonda tekrar
        // denenecek. pollOnce stale token ile 401 yiyebilir, oradan
        // da kurtarma yolu var.
      }
    }
    session = await pollOnce(cfg, session, printerConfig);
  }
}

void main();
