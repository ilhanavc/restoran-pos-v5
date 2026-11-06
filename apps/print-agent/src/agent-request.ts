import type {
  AgentRegisterRequest,
  PrintJobKind,
} from '@restoran-pos/shared-types';
import { VERSION } from './version.js';

/**
 * Cloud'a giden iki isteğin **sorgu/gövde kurulumu** — ADR-044 K4.
 *
 * Neden ayrı modül: `index.ts` modül yüklenirken `main()` çağırıyor, yani
 * import edilemez → kurulumu orada bırakırsak "sürüm gerçekten gidiyor mu"
 * sorusu ancak canlı trafikle cevaplanabilirdi. Sürümün gitmemesi SESSİZ bir
 * arızadır (ekranda "bilinmiyor" yazar, kimse sebebini bilmez) — tam olarak
 * K4'ün kapatmak için var olduğu körlük sınıfı. Kurulum tek yerde ve test
 * edilebilir durur.
 */

/**
 * `GET /print/v1/jobs/next` sorgu dizgesi.
 *
 * `wait` + (ADR-032) tekrarlı `kind` + (ADR-044 K4) `agentVersion`.
 * `agentVersion` **daima** eklenir: sunucu geçersiz/eksik değeri NULL'a
 * düşürüyor ve istek 400 olmuyor, yani eski sunucuya karşı da zararsızdır
 * (bilinmeyen query param yok sayılır).
 */
export function buildJobsNextQuery(opts: {
  longPollSeconds: number;
  jobKinds: readonly PrintJobKind[] | undefined;
}): string {
  const params = new URLSearchParams({
    wait: opts.longPollSeconds.toString(),
  });
  if (opts.jobKinds !== undefined) {
    for (const kind of opts.jobKinds) params.append('kind', kind);
  }
  params.set('agentVersion', VERSION);
  return params.toString();
}

/**
 * `POST /print/v1/agent/register` gövdesi. Sürüm burada da gider ki taze
 * kurulumda yazıcı kartı ilk poll'u beklemeden sürümü göstersin.
 */
export function buildRegisterBody(opts: {
  apiKey: string;
  deviceFingerprint: string;
}): AgentRegisterRequest {
  return {
    apiKey: opts.apiKey,
    deviceFingerprint: opts.deviceFingerprint,
    agentVersion: VERSION,
  };
}
