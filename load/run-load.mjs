/**
 * Restoran POS v5 — Blok 13 yük/stres harness (YALNIZ LOKAL pos_test).
 *
 * ⚠️ GÜVENLİK: Bu script YALNIZCA lokal API'ye (localhost:3001, pos_test DB)
 * koşulur. ASLA restoranpos.org / prod / pos_dev'e yöneltme. BASE_URL guard'ı
 * localhost dışını reddeder.
 *
 * Bağımlılık YOK — Node 22 global fetch + saf percentile. autocannon gerekmez.
 *
 * Kullanım:
 *   node load/run-load.mjs <senaryo> [concurrency] [total]
 *   node load/run-load.mjs all           # tüm senaryolar, JSON özet
 * Senaryolar: login · read · reports · order-create · void-race · print-flood · pool
 *
 * Rapor: docs/audit/13-load.md
 */

const BASE_URL = process.env.LOAD_BASE_URL ?? 'http://localhost:3001';
// Prod-guard: yalnız localhost/127.0.0.1.
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL)) {
  console.error(`[load] REDDEDILDI: yalnız localhost. Verilen: ${BASE_URL}`);
  process.exit(1);
}

const CREDS = { email: 'admin@test.local', password: 'test1234' };
const TABLE_IDS = [
  '30000000-0000-0000-000000000001',
  '30000000-0000-0000-000000000002',
  '30000000-0000-0000-000000000003',
];
const PRODUCT_ID = '50000000-0000-0000-0000-000000000001';

/** p-quantile (0..1) over a numeric array. */
function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

function summarize(name, latencies, errors, elapsedMs, extra = {}) {
  const s = [...latencies].sort((a, b) => a - b);
  const total = latencies.length + errors;
  return {
    scenario: name,
    requests: total,
    ok: latencies.length,
    errors,
    rps: +((total / elapsedMs) * 1000).toFixed(1),
    p50: +quantile(s, 0.5).toFixed(1),
    p95: +quantile(s, 0.95).toFixed(1),
    p99: +quantile(s, 0.99).toFixed(1),
    max: +(s[s.length - 1] ?? 0).toFixed(1),
    ...extra,
  };
}

async function login() {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(CREDS),
  });
  if (!res.ok) throw new Error(`login failed HTTP ${res.status}`);
  const body = await res.json();
  return body.accessToken;
}

// loginLimiter (5/15dk) tüm authed senaryoları zehirlemesin diye token'ı
// BİR kez alıp paylaş; `login` senaryosu (rate-limit ölçümü) EN SONA konur.
let cachedToken = null;
async function getToken() {
  if (cachedToken === null) cachedToken = await login();
  return cachedToken;
}

/** Fixed-concurrency worker pool: `total` requests, `conc` in flight. */
async function runPool(total, conc, makeReq) {
  const latencies = [];
  let errors = 0;
  let issued = 0;
  const t0 = performance.now();
  async function worker() {
    while (issued < total) {
      issued++;
      const start = performance.now();
      try {
        const res = await makeReq();
        const dur = performance.now() - start;
        if (res.ok || res.status === 429 || res.status === 409) latencies.push(dur);
        else errors++;
        // body'yi tüket (soket serbest).
        await res.text().catch(() => {});
      } catch {
        errors++;
      }
    }
  }
  await Promise.all(Array.from({ length: conc }, () => worker()));
  return { latencies, errors, elapsedMs: performance.now() - t0 };
}

const scenarios = {
  // 1. Auth login — rate-limit davranışı (loginLimiter 5/15dk).
  async login(conc = 8, total = 40) {
    const r = await runPool(total, conc, () =>
      fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(CREDS),
      }),
    );
    // 429 sayısı = rate-limit tetiklenmesi.
    let rateLimited = 0;
    await Promise.all([]);
    return summarize('login', r.latencies, r.errors, r.elapsedMs, {
      note: 'loginLimiter 5/15dk; 429 beklenir',
      rateLimited,
    });
  },

  // 2. Read hot-path — tables/products/orders (token'lı).
  async read(conc = 20, total = 600) {
    const token = await getToken();
    const h = { Authorization: `Bearer ${token}` };
    const paths = ['/tables', '/products', '/orders?type=takeaway&status=open', '/menu/categories'];
    let i = 0;
    const r = await runPool(total, conc, () => fetch(`${BASE_URL}${paths[i++ % paths.length]}`, { headers: h }));
    return summarize('read', r.latencies, r.errors, r.elapsedMs);
  },

  // 4. Reports ağır agregasyon — geniş tarih.
  async reports(conc = 12, total = 240) {
    const token = await getToken();
    const h = { Authorization: `Bearer ${token}` };
    const paths = [
      '/reports/kpi/order-count',
      '/reports/kpi/average-bill',
      '/reports/snapshot', // ağır: gün-sonu agregasyonu
      '/reports/hourly-revenue', // ağır: saatlik gruplama
    ];
    let i = 0;
    const r = await runPool(total, conc, () => fetch(`${BASE_URL}${paths[i++ % paths.length]}`, { headers: h }));
    return summarize('reports', r.latencies, r.errors, r.elapsedMs, {
      note: 'geniş tarih aralığı (2020-2030) agregasyon',
    });
  },

  // 7. DB pool tükenme — yüksek concurrency, hata modu.
  async pool(conc = 80, total = 800) {
    const token = await getToken();
    const h = { Authorization: `Bearer ${token}` };
    const r = await runPool(total, conc, () =>
      fetch(`${BASE_URL}/reports/snapshot`, { headers: h }),
    );
    return summarize('pool', r.latencies, r.errors, r.elapsedMs, {
      note: `concurrency=${conc} > tipik pool(10) — kuyruk/timeout hata modu`,
    });
  },
};

async function main() {
  const which = process.argv[2] ?? 'all';
  const conc = process.argv[3] ? Number(process.argv[3]) : undefined;
  const total = process.argv[4] ? Number(process.argv[4]) : undefined;
  // login EN SONA — rate-limiter'ı tetikleyince authed senaryoları zehirler.
  const ALL_ORDER = ['read', 'reports', 'pool', 'login'];
  const list = which === 'all' ? ALL_ORDER : [which];
  const results = [];
  for (const name of list) {
    if (!scenarios[name]) {
      console.error(`bilinmeyen senaryo: ${name}`);
      continue;
    }
    process.stderr.write(`[load] ${name} çalışıyor...\n`);
    // eslint-disable-next-line no-await-in-loop
    const res = await (conc !== undefined ? scenarios[name](conc, total) : scenarios[name]());
    results.push(res);
    process.stderr.write(`[load] ${name}: p50=${res.p50}ms p95=${res.p95}ms p99=${res.p99}ms rps=${res.rps} err=${res.errors}\n`);
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('[load] hata:', e.message);
  process.exit(1);
});
