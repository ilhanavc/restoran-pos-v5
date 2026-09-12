import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * Route yetkilendirme KAPSAM guard'ı (DD GUV-1 — "yeni-route sahiplik unutma
 * riski → merkezileştir+test").
 *
 * `rbac-parity.test.ts` (ADR-034 B2) authorize() rol DİZİLERİNİ matrisle
 * kilitler; bu test tamamlayıcı **presence** katmanıdır: her route kaydının
 * (`router.<method>(...)`) middleware zincirinde bir kimlik-doğrulama
 * (`authenticate` veya agent-JWT `requireAgentJwt`) VE (mutating + kullanıcı-
 * authenticated ise) `authorize` BULUNDUĞUNU doğrular. Yeni bir route bu
 * kapıları unutursa — veya bilinçli istisnaysa allowlist'e yazılmazsa — KIRAR.
 *
 * Amaç: RBAC merkezi (`middleware/authorize.ts`) ama uygulaması per-route;
 * kapı eklemeyi unutmak sessiz bir yetki açığıdır. Bu guard onu CI'da yakalar.
 *
 * Kapsam-dışı (bilinçli): resource-ownership ABAC inline-conditional katmanı
 * (waiter-own-order, self-password) — bu test yalnız middleware VARLIĞINI görür,
 * handler-içi attribute-scoping'i değil (ABAC katmanı merkezileştirme = v5.1).
 */

const ROUTES_DIR = fileURLToPath(new URL('../routes', import.meta.url));
const MUTATING = new Set(['post', 'patch', 'put', 'delete']);

function listRouteFiles(): string[] {
  return readdirSync(ROUTES_DIR, { recursive: true })
    .map((p) => String(p).replace(/\\/g, '/'))
    .filter((p) => p.endsWith('.ts') && !p.endsWith('.test.ts'));
}

interface RouteReg {
  file: string;
  method: string;
  path: string;
  /** `router.<method>( ... )` çağrısının TAMAMI (path + middleware + handler). */
  call: string;
}

/** `open` bir `(` konumu; eşleşen `)` konumunu döndürür (paren-derinlik sayımı). */
function matchParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return src.length;
}

/**
 * Bir route dosyasındaki her `router.<method>('path', ...)` kaydını, çağrının
 * eşleşen kapanış parantezine kadar (named-handler dahil) ayrıştırır. Middleware
 * varlığını çağrı metninde arar; düzgün korunan route her zaman token'ı içerir
 * (yanlış-POZİTİF yok — properly-guarded route asla flag'lenmez).
 */
function parseRoutes(rel: string): RouteReg[] {
  const abs = fileURLToPath(new URL(`../routes/${rel}`, import.meta.url));
  const src = readFileSync(abs, 'utf8');
  const re = /router\.(get|post|patch|put|delete)\(/g;
  const out: RouteReg[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const method = m[1] ?? '';
    const open = re.lastIndex - 1; // matched '(' konumu
    const close = matchParen(src, open);
    const call = src.slice(open, close + 1);
    const pathMatch = /^\(\s*(['"`])([^'"`]*)\1/.exec(call);
    const path = pathMatch?.[2] ?? '?';
    out.push({ file: rel, method, path, call });
    re.lastIndex = close + 1;
  }
  return out;
}

function hasAuthenticate(r: RouteReg): boolean {
  return /\bauthenticate\s*\(/.test(r.call) || /\brequireAgentJwt\s*\(/.test(r.call);
}
function isAgentAuthed(r: RouteReg): boolean {
  return /\brequireAgentJwt\s*\(/.test(r.call);
}
function hasAuthorize(r: RouteReg): boolean {
  return /\bauthorize\s*\(/.test(r.call);
}

/** Kimlik-doğrulaması OLMAYAN (public) route'lar — (file, METHOD, path). */
const PUBLIC_ALLOWLIST = new Set<string>([
  // auth.ts — kimlik uçları public (henüz oturum yok)
  'auth.ts POST /login',
  'auth.ts POST /refresh',
  'auth.ts POST /logout',
  // caller-id — Caller Bridge webhook (X-Bridge-Token + X-Tenant-Id middleware)
  'caller-id/index.ts POST /incoming',
  // print-jobs — agent bootstrap: apiKey'in KENDİSİ kimlik kanıtı (register
  // bcrypt.compare, refresh JWT-rotate); prior token yok → login gibi public
  // (handler-içi doğrulama + agentAuthLimiter). print-jobs.ts:544.
  'print-jobs.ts POST /agent/register',
  'print-jobs.ts POST /agent/refresh',
]);

/** authenticate VAR ama `authorize` YOK — bilinçli inline-ABAC (self/admin). */
const NO_AUTHORIZE = new Set<string>([
  // users.ts — self/admin parola sıfırlama inline ABAC guard'ı (rbac-parity B2 not)
  'users.ts PATCH /:id/password',
]);

function id(r: RouteReg): string {
  return `${r.file} ${r.method.toUpperCase()} ${r.path}`;
}

describe('route yetkilendirme kapsamı (DD GUV-1)', () => {
  const routes = listRouteFiles().flatMap(parseRoutes);

  it('yeterli route ayrıştırıldı (parser sağlığı)', () => {
    expect(routes.length).toBeGreaterThan(30);
    // path='?' = paren/parse başarısızlığı — olmamalı
    expect(routes.filter((r) => r.path === '?').map(id)).toEqual([]);
  });

  it('her route kimlik-doğrulaması içerir: authenticate | requireAgentJwt (public istisnalar hariç)', () => {
    const offenders = routes
      .filter((r) => !PUBLIC_ALLOWLIST.has(id(r)))
      .filter((r) => !hasAuthenticate(r))
      .map(id);
    expect(offenders).toEqual([]);
  });

  it('her MUTATING kullanıcı-route authorize içerir (agent-JWT / inline-ABAC / public hariç)', () => {
    const offenders = routes
      .filter((r) => MUTATING.has(r.method))
      .filter((r) => !PUBLIC_ALLOWLIST.has(id(r)))
      .filter((r) => !NO_AUTHORIZE.has(id(r)))
      .filter((r) => !isAgentAuthed(r)) // agent uçları rol-authorize kullanmaz
      .filter((r) => !hasAuthorize(r))
      .map(id);
    expect(offenders).toEqual([]);
  });

  it('allowlist girdileri gerçek route kayıtlarına işaret eder (bayat-istisna guard)', () => {
    const real = new Set(routes.map(id));
    const stale = [...PUBLIC_ALLOWLIST, ...NO_AUTHORIZE].filter((e) => !real.has(e));
    expect(stale).toEqual([]);
  });
});
