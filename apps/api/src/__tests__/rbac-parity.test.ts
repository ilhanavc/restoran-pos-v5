import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  hasPermission,
  type Action,
  type UserRole,
} from '@restoran-pos/shared-types';

/**
 * RBAC parite testi (ADR-034 B2 — "hizala + kapsam-sınırlı parite CI testi").
 *
 * KÖK PROBLEM (derin denetim API-AZ-01 / SD-T-B-02 / R7-AZ-01): matris
 * (`packages/shared-types/src/permissions.ts`) apps/api'de HİÇ tüketilmiyor —
 * route'lar rolleri `authorize([...])` ile HARDCODE eder. Matris değişse route
 * davranışı değişmez → "tek-kaynak yanılsaması". Bu test yanılsamayı GERÇEĞE
 * çevirir: matris-kapsamlı her route için gerçek `authorize([...])` rol dizisi ile
 * `hasPermission(role, action)` matrisi CI'da birebir kilitlenir.
 *
 * KAPSAM (ADR-034 B2): matris-kapsamlı aileler = orders / payments / tables / menu
 * / users / kds / reports / caller / tenant.settings(settings.ts). Bu ailelerdeki
 * her authorize() route'u aşağıdaki REGISTRY'de map'lidir. Registry'de OLMAYAN yeni
 * authorize'lı route eklenirse test KIRAR (drift-guard: dosya bazında authorize-dizi
 * çokkümesi == registry çokkümesi).
 *
 * KAPSAM DIŞI:
 *  - Muaf-aileler (customers/products/areas/attribute-groups + auth/print-jobs):
 *    "hardcoded-authorize, matris-muaf" — EXEMPT_FILES'ta AÇIKÇA listeli (B2 kararı;
 *    matris bu eylemleri enumerate etmez). Parite iddiası yok.
 *  - ABAC inline-conditional katmanı (waiter-own-order, self-password reset, kitchen-
 *    routed items). Bu test YALNIZ `authorize()` (RBAC) katmanını doğrular; route
 *    handler içindeki attribute-scoping'i (req.user.sub === order.created_by vb.)
 *    kapsamaz. ABAC'lı bazı route'lar (PATCH /users/:id/password) authorize()
 *    KULLANMAZ (authenticate + inline check) → çokkümede yer almaz, bilinçlidir.
 *  - Operasyonel-kısıtlı route'lar (action:null): authorize dizisi tek bir matris
 *    aksiyonuna temiz map olmayan route'lar (ör. takeaway-stage admin+cashier).
 *    Çokkümede sayılır (drift-guard) ama parite assert edilmez — bilinçli işaretli.
 */

const ROUTES_DIR = fileURLToPath(new URL('../routes', import.meta.url));

const ROLES: readonly UserRole[] = ['admin', 'cashier', 'waiter', 'kitchen'];

// ---------------------------------------------------------------------------
// Kaynak-okuma yardımcıları
// ---------------------------------------------------------------------------

/** Blok (JSDoc dahil) + satır yorumlarını çıkarır — yorumdaki `authorize([...])`
 *  referanslarının (ör. users.ts JSDoc) çokkümeyi kirletmesini engeller. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Bir kaynak dosyadaki tüm `authorize(['a','b'])` çağrılarının rol dizilerini
 *  çıkarır. Yalnız string-literal dizileri destekler (matris-kapsamlı ailelerin
 *  hepsi literal kullanır; spread/değişken kullanan attribute-groups MUAF). */
function extractAuthorizeRoleArrays(absPath: string): string[][] {
  const cleaned = stripComments(readFileSync(absPath, 'utf8'));
  const re = /authorize\(\s*\[([^\]]*)\]\s*\)/g;
  const out: string[][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const inner = m[1] ?? '';
    const roles = inner
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter((s) => s.length > 0);
    out.push(roles);
  }
  return out;
}

/** Rol dizisini sıralı-kanonik anahtara çevirir (çokküme karşılaştırması için). */
function key(roles: readonly string[]): string {
  return [...roles].sort().join('+');
}

/** Bir sıralı-anahtar-listesini çokküme (anahtar → adet) yapar. */
function multiset(keys: readonly string[]): Map<string, number> {
  const ms = new Map<string, number>();
  for (const k of keys) ms.set(k, (ms.get(k) ?? 0) + 1);
  return ms;
}

/** routes/ altındaki tüm .ts route dosyaları (test hariç), '/' ayraçlı relatif. */
function listRouteFiles(): string[] {
  return readdirSync(ROUTES_DIR, { recursive: true })
    .map((p) => String(p).replace(/\\/g, '/'))
    .filter((p) => p.endsWith('.ts') && !p.endsWith('.test.ts'));
}

// ---------------------------------------------------------------------------
// REGISTRY — matris-kapsamlı route → action map (ADR-034 B2)
// ---------------------------------------------------------------------------

type RouteEntry = {
  method: string;
  path: string;
  roles: UserRole[];
  /** null = operasyonel-kısıtlı / matris read-aksiyonu yok — parite assert edilmez. */
  action: Action | null;
  note?: string;
};

type EnumeratedFamily = { name: string; file: string; entries: RouteEntry[] };

const ENUMERATED: readonly EnumeratedFamily[] = [
  {
    name: 'orders',
    file: 'orders.ts',
    entries: [
      { method: 'POST', path: '/', roles: ['admin', 'cashier', 'waiter'], action: 'orders.create', note: 'takeaway create' },
      { method: 'GET', path: '/', roles: ['admin', 'cashier', 'waiter', 'kitchen'], action: 'orders.read' },
      { method: 'POST', path: '/:id/print-bill', roles: ['admin', 'cashier', 'waiter'], action: 'print.bill' },
      { method: 'PATCH', path: '/:id/takeaway-stage', roles: ['admin', 'cashier'], action: null, note: 'takeaway aşama geçişi — operasyonel-kısıtlı (waiter HARİÇ); tek matris aksiyonuna map DEĞİL' },
      // ADR-027 Amd2 K2/K9 — kanonik iptal ucu garsona+kasiyere açıldı.
      // Parasal koruma rolde DEĞİL para durumunda: aktif ödemesi olan adisyonu
      // cancelOrderTx tüm roller için reddeder (ORDER_HAS_PAYMENTS).
      {
        method: 'POST',
        path: '/:id/cancel',
        roles: ['admin', 'cashier', 'waiter'],
        action: 'orders.cancel',
      },
      { method: 'POST', path: '/', roles: ['admin', 'cashier', 'waiter'], action: 'orders.create', note: 'dine-in create' },
      { method: 'POST', path: '/:id/items', roles: ['admin', 'cashier', 'waiter'], action: 'orders.update' },
      { method: 'PATCH', path: '/:id', roles: ['admin', 'cashier'], action: null, note: 'adisyon düzeltme / Mod B masayı-kapat — operasyonel-kısıtlı (waiter HARİÇ)' },
      { method: 'PATCH', path: '/:id/customer', roles: ['admin', 'cashier', 'waiter'], action: 'orders.update' },
      { method: 'PATCH', path: '/:orderId/table', roles: ['admin', 'cashier', 'waiter'], action: 'orders.move' },
      { method: 'POST', path: '/:sourceOrderId/merge', roles: ['admin', 'cashier', 'waiter'], action: 'orders.merge' },
      { method: 'PATCH', path: '/:orderId/items/:itemId', roles: ['admin', 'cashier', 'waiter'], action: 'orders.update' },
      { method: 'GET', path: '/:id', roles: ['admin', 'cashier', 'waiter', 'kitchen'], action: 'orders.read' },
      { method: 'GET', path: '/', roles: ['admin', 'cashier', 'waiter', 'kitchen'], action: 'orders.read' },
      { method: 'PATCH', path: '/:orderId/items/:itemId/status', roles: ['admin', 'kitchen'], action: 'kds.itemStatusUpdate' },
    ],
  },
  {
    name: 'payments',
    file: 'payments.ts',
    entries: [
      { method: 'POST', path: '/', roles: ['admin', 'cashier', 'waiter'], action: 'payments.create' },
      { method: 'GET', path: '/', roles: ['admin', 'cashier', 'waiter'], action: null, note: 'ödeme listeleme — matris read-aksiyonu yok' },
      { method: 'GET', path: '/orders/:orderId/split-state', roles: ['admin', 'cashier', 'waiter'], action: null, note: 'bölme-durum okuma — matris read-aksiyonu yok' },
      { method: 'POST', path: '/:paymentId/void', roles: ['admin', 'cashier'], action: 'payments.void', note: 'ADR-033 K6 / Drift-2a' },
    ],
  },
  {
    name: 'tables',
    file: 'tables.ts',
    entries: [
      { method: 'POST', path: '/', roles: ['admin'], action: 'tables.manage' },
      { method: 'GET', path: '/', roles: ['admin', 'cashier', 'waiter', 'kitchen'], action: 'tables.read' },
      { method: 'PATCH', path: '/:id', roles: ['admin'], action: 'tables.manage' },
      { method: 'DELETE', path: '/:id', roles: ['admin'], action: 'tables.manage' },
      { method: 'PATCH', path: '/:id/area', roles: ['admin'], action: 'tables.manage' },
    ],
  },
  {
    name: 'menu',
    file: 'menu.ts',
    entries: [
      { method: 'POST', path: '/categories', roles: ['admin'], action: 'menu.manage' },
      { method: 'GET', path: '/categories', roles: ['admin', 'cashier', 'waiter', 'kitchen'], action: 'menu.read' },
      { method: 'PATCH', path: '/categories/:id', roles: ['admin'], action: 'menu.manage' },
      { method: 'DELETE', path: '/categories/:id', roles: ['admin'], action: 'menu.manage' },
      { method: 'POST', path: '/categories/:id/products/reorder', roles: ['admin'], action: 'menu.manage' },
      { method: 'POST', path: '/categories/reorder', roles: ['admin'], action: 'menu.manage' },
    ],
  },
  {
    name: 'users',
    file: 'users.ts',
    entries: [
      { method: 'POST', path: '/', roles: ['admin'], action: 'users.manage' },
      { method: 'GET', path: '/', roles: ['admin'], action: 'users.manage' },
      { method: 'GET', path: '/:id', roles: ['admin'], action: 'users.manage' },
      { method: 'PATCH', path: '/:id', roles: ['admin'], action: 'users.manage' },
      { method: 'DELETE', path: '/:id', roles: ['admin'], action: 'users.manage' },
      // NOT: PATCH /:id/password authorize() KULLANMAZ (authenticate + inline ABAC
      // self/admin-reset guard) → çokkümede yer almaz; users.password.change eylemi
      // bu ABAC katmanında zorlanır (RESERVED_OR_ABAC).
    ],
  },
  {
    name: 'kds',
    file: 'kds.ts',
    entries: [{ method: 'GET', path: '/orders', roles: ['admin', 'kitchen'], action: 'kds.read' }],
  },
  {
    name: 'tenant.settings',
    file: 'settings.ts',
    entries: [
      { method: 'GET', path: '/', roles: ['admin', 'cashier'], action: 'tenant.settings.read' },
      { method: 'PATCH', path: '/', roles: ['admin'], action: 'tenant.settings' },
    ],
  },
  {
    name: 'caller',
    file: 'caller-id/index.ts',
    entries: [
      { method: 'GET', path: '/logs', roles: ['admin', 'cashier'], action: 'caller.read' },
      { method: 'PATCH', path: '/logs/:id/status', roles: ['admin', 'cashier'], action: 'caller.log.update', note: 'ADR-016 §11 / Drift-3a' },
      // NOT: POST /incoming authorize() KULLANMAZ (Caller Bridge webhook, X-Tenant-Id
      // + agent doğrulaması) → çokkümede yer almaz, bilinçlidir.
    ],
  },
];

/** Uniform aile: reports/* — her authorize() route'u aynı politika: [admin,cashier]
 *  → reports.read. 13 GET rapor endpoint'i (daily-close-aggregate/index/tz authorize
 *  KULLANMAZ). Yeni bir rapor route'u farklı rol dizisiyle eklenirse test KIRAR. */
const REPORTS = {
  dirPrefix: 'reports/',
  roles: ['admin', 'cashier'] as UserRole[],
  action: 'reports.read' as Action,
};

/** Muaf-aileler (ADR-034 B2): hardcoded-authorize, matris bu eylemleri enumerate
 *  ETMEZ → parite iddiası yok. Root index.ts = aggregator (route tanımlamaz). */
const EXEMPT_FILES: readonly string[] = [
  'customers/index.ts', // 16 route, PII — matris-dışı
  'products.ts',
  'areas.ts',
  'attribute-groups.ts', // authorize([...READ_ROLES]) spread — literal-parse edilmez
  'auth.ts', // rol-dışı: login/refresh (authenticate, authorize yok)
  'print-jobs.ts', // Print Agent JWT (requireAgentJwt, authorize yok)
  'index.ts', // root router aggregator
];

/** Matriste TANIMLI ama hiçbir matris-kapsamlı authorize() route'una map OLMAYAN
 *  eylemler — bilinçli rezerv/ABAC. Registry action'larında görünmemeliler. */
const RESERVED_OR_ABAC: readonly Action[] = [
  'orders.comp', // dedicated authorize route yok — item-toggle (PATCH /:orderId/items/:itemId, orders.update authorize) + ABAC ile zorlanır (waiter comp HARİÇ)
  'payments.refund', // v5.1 — route yok (errors.ts:148)
  'reports.run', // v5.1 ağır-rapor rezervi — route yok
  'caller.manage', // gelecek istasyon-config rezervi — route yok
  'printer.settings', // matris-kapsamlı ailede route yok
  'audit.read', // matris-kapsamlı ailede route yok
  'menu.price.update', // fiyat mutasyonu MUAF products ailesinde
  'users.password.change', // ABAC route (authorize'sız) — çokkümede yok
];

// ---------------------------------------------------------------------------
// TESTLER
// ---------------------------------------------------------------------------

describe('RBAC parite — matris ↔ route (ADR-034 B2)', () => {
  describe('parite: authorize() rol dizisi == hasPermission(role, action)', () => {
    for (const fam of ENUMERATED) {
      for (const e of fam.entries.filter((x) => x.action !== null)) {
        it(`${fam.name}: ${e.method} ${e.path} [${e.roles.join(',')}] == matris(${e.action})`, () => {
          for (const role of ROLES) {
            expect(hasPermission(role, e.action as Action)).toBe(e.roles.includes(role));
          }
        });
      }
    }

    it(`reports/*: [${REPORTS.roles.join(',')}] == matris(${REPORTS.action})`, () => {
      for (const role of ROLES) {
        expect(hasPermission(role, REPORTS.action)).toBe(REPORTS.roles.includes(role));
      }
    });
  });

  describe('drift-guard: dosya authorize çokkümesi == registry çokkümesi', () => {
    for (const fam of ENUMERATED) {
      it(`${fam.name} (${fam.file}): kaynaktaki authorize() dizileri registry ile eşleşir`, () => {
        const abs = fileURLToPath(new URL(`../routes/${fam.file}`, import.meta.url));
        const source = multiset(extractAuthorizeRoleArrays(abs).map(key));
        const expected = multiset(fam.entries.map((e) => key(e.roles)));
        expect(Object.fromEntries(source)).toEqual(Object.fromEntries(expected));
      });
    }

    it('reports/*: her authorize() dizisi [admin,cashier] (reports.read)', () => {
      const reportFiles = listRouteFiles().filter((p) => p.startsWith(REPORTS.dirPrefix));
      expect(reportFiles.length).toBeGreaterThan(0);
      const expectedKey = key(REPORTS.roles);
      for (const rel of reportFiles) {
        const abs = fileURLToPath(new URL(`../routes/${rel}`, import.meta.url));
        for (const arr of extractAuthorizeRoleArrays(abs)) {
          expect(key(arr)).toBe(expectedKey);
        }
      }
    });
  });

  describe('kapsam bütünlüğü', () => {
    it('her route dosyası SCOPED ya da EXEMPT olarak sınıflandırılmış (yeni dosya → KIRAR)', () => {
      const all = new Set(listRouteFiles());
      const classified = new Set<string>([
        ...ENUMERATED.map((f) => f.file),
        ...EXEMPT_FILES,
        ...[...all].filter((p) => p.startsWith(REPORTS.dirPrefix)),
      ]);
      const unclassified = [...all].filter((p) => !classified.has(p));
      expect(unclassified).toEqual([]);
      // Registry'de listelenen dosyalar gerçekten var mı (bayat girdi guard'ı)
      const missing = [...classified].filter((p) => !all.has(p));
      expect(missing).toEqual([]);
    });

    it('rezerv/ABAC eylemleri hicbir registry-action map DEGIL (bilincli)', () => {
      const mapped = new Set<Action>([
        ...ENUMERATED.flatMap((f) => f.entries.map((e) => e.action).filter((a): a is Action => a !== null)),
        REPORTS.action,
      ]);
      for (const a of RESERVED_OR_ABAC) {
        expect(mapped.has(a)).toBe(false);
      }
    });
  });
});
