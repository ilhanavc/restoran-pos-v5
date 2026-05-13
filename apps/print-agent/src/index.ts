import {
  JobsNextResponseSchema,
  type JobsNextResponse,
} from '@restoran-pos/shared-types';

/**
 * Print Agent skeleton — ADR-004 §2 + §6 Soru #6.
 *
 * Phase 3 PR-1 scope (decisions.md ADR-004 §Phase 3 PR-1 Scope Kilidi):
 *   - Yalnız uzun yoklama döngüsü (long-poll GET /print/v1/jobs/next).
 *   - Job alındığında konsola log atar — printer transport YOK.
 *   - 204 alındığında hemen yeniden poll'a girer (0 bekleme).
 *   - Auth: `X-Tenant-Id` header (Phase 4+'da JWT + agent register/refresh).
 *
 * Yapılacak (Phase 4+):
 *   - POST /print/v1/agent/register + refresh akışı (Bearer JWT)
 *   - Job payload byte stream / ESC-POS render
 *   - POST /print/v1/jobs/:id/result success/failed callback + retry policy
 *   - MSI installer + Windows service (nssm/sc.exe) — başka PR
 *
 * Env değişkenleri:
 *   - PRINT_AGENT_API_URL    (default: http://localhost:4001)
 *   - PRINT_AGENT_TENANT_ID  (zorunlu, UUID)
 *   - PRINT_AGENT_LONGPOLL_S (default: 25, server üst sınırı)
 *
 * NOT: Print Agent kullanıcıya görünen UI yok — sadece log. Kullanıcıya
 * gösterilecek hata mesajları (Phase 4+) i18n key'lerle gelir (UI tarafı
 * Phase 5'te entegre olur).
 */

const DEFAULT_API_URL = 'http://localhost:4001';
const DEFAULT_LONGPOLL_SECONDS = 25;

interface AgentConfig {
  apiUrl: string;
  tenantId: string;
  longPollSeconds: number;
}

function loadConfig(): AgentConfig {
  const apiUrl = process.env['PRINT_AGENT_API_URL'] ?? DEFAULT_API_URL;
  const tenantId = process.env['PRINT_AGENT_TENANT_ID'] ?? '';
  if (tenantId === '') {
    console.error(
      '[print-agent] PRINT_AGENT_TENANT_ID env değişkeni zorunlu (Phase 3 PR-1 mock auth).',
    );
    process.exit(1);
  }
  const longPollRaw = process.env['PRINT_AGENT_LONGPOLL_S'];
  const longPollSeconds =
    longPollRaw === undefined || longPollRaw === ''
      ? DEFAULT_LONGPOLL_SECONDS
      : Math.max(0, Math.min(25, Number(longPollRaw) || DEFAULT_LONGPOLL_SECONDS));
  return { apiUrl, tenantId, longPollSeconds };
}

/**
 * Tek poll iterasyonu. Hata fırlatmaz — tüm hatalar log'a, döngü
 * devam eder. Bu sayede ağ kesintisi → restart döngüsü olmaz; agent
 * bağlantı geri gelene kadar log'lar ve poll'lamayı sürdürür.
 *
 * Dönüş: `true` job işlendi (hemen yeniden poll), `false` 204 / hata
 * (hemen yeniden poll). Phase 3 PR-1'de davranış aynı — fark gelecekte
 * print süresi backoff'unda gerekecek.
 */
async function pollOnce(cfg: AgentConfig): Promise<boolean> {
  const url = `${cfg.apiUrl}/print/v1/jobs/next?wait=${cfg.longPollSeconds}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'X-Tenant-Id': cfg.tenantId },
    });
  } catch (err) {
    console.error(
      `[print-agent] fetch hatası (${url}):`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }

  if (response.status === 204) {
    console.log('[print-agent] kuyruk boş (204)');
    return false;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '<body okunamadı>');
    console.error(
      `[print-agent] HTTP ${response.status.toString()}: ${text}`,
    );
    return false;
  }

  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch (err) {
    console.error(
      '[print-agent] JSON parse hatası:',
      err instanceof Error ? err.message : err,
    );
    return false;
  }

  const parsed = JobsNextResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    console.error(
      '[print-agent] yanıt şema uyuşmuyor:',
      parsed.error.issues,
    );
    return false;
  }

  const job: JobsNextResponse['job'] = parsed.data.job;
  console.log(
    `[print-agent] job alındı: id=${job.id} status=${job.status} createdAt=${job.createdAt}`,
  );
  // Phase 4+: payload → ESC-POS byte stream → printer transport →
  //          POST /print/v1/jobs/:id/result
  return true;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  console.log(
    `[print-agent] başlatıldı (api=${cfg.apiUrl}, tenant=${cfg.tenantId}, longPoll=${cfg.longPollSeconds.toString()}s)`,
  );
  // Long-poll döngüsü — server zaten beklemeyi yapar; client tarafı
  // hemen yeniden poll'a girer.
  for (;;) {
    await pollOnce(cfg);
  }
}

void main();
