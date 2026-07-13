/**
 * Blok 9 (apps/web) — YEŞİL sınır testleri (denetimde temiz çıkan pozitifler).
 *
 * Bu dosya denetimin doğruladığı güvenlik/dayanıklılık invariant'larını
 * regresyona karşı kilitler. Hepsi YEŞİL olmalı; kırmızıya dönmesi
 * güvenlik duruşunun bozulduğu anlamına gelir.
 *
 * Koşum: node --test apps/web/audit/
 * Rapor: docs/audit/09-web.md §0 "Güçlü çıkanlar"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const webSrc = join(webRoot, 'src');
const read = (rel) => readFileSync(join(webSrc, rel), 'utf8');

/** Recursively collect .ts/.tsx sources under src. */
const collect = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collect(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
};
const allSources = () => collect(webSrc).map((p) => ({ p, src: readFileSync(p, 'utf8') }));

test('SEC: dangerouslySetInnerHTML/innerHTML hiçbir kaynakta kullanılmamalı (XSS yüzeyi)', () => {
  const hits = allSources().filter(({ src }) => /dangerouslySetInnerHTML|\.innerHTML\s*=/.test(src));
  assert.deepEqual(hits.map((h) => h.p), []);
});

test('SEC: access token in-memory kalmalı — auth store persist/localStorage kullanmamalı', () => {
  const auth = read('store/auth.ts');
  assert.ok(!auth.includes('persist('), 'auth store persist middleware kullanıyor');
  // Gerçek API erişimi ara (yorumdaki "localStorage" sözcüğü değil).
  const ls = allSources().filter(({ src }) => /(?:window\.)?localStorage\s*[.[]/.test(src));
  assert.deepEqual(ls.map((h) => h.p), [], 'src içinde localStorage kullanımı yok olmalı');
});

test('ROB: App kökünde ErrorBoundary + Toaster mount edilmiş olmalı', () => {
  const app = read('App.tsx');
  assert.ok(app.includes('<ErrorBoundary>'), 'kök ErrorBoundary yok');
  assert.ok(app.includes('<Toaster'), 'sonner Toaster mount edilmemiş');
});

test('ROB: 401 refresh single-flight + CSRF-lite header korunmalı (lib/api.ts)', () => {
  const api = read('lib/api.ts');
  assert.ok(api.includes('refreshPromise ??='), 'single-flight refresh deseni bozulmuş');
  assert.ok(api.includes("'X-Refresh-Request'"), 'CSRF-lite X-Refresh-Request header kayıp');
  assert.ok(api.includes('withCredentials: true'), 'refresh cookie taşınmıyor');
});

test("QUAL: `any` tipi yasağı — src'de any kullanımı olmamalı (CLAUDE.md)", () => {
  const offenders = allSources().filter(({ src }) => /(:\s*any\b|as\s+any\b|<any>)/.test(src));
  assert.deepEqual(offenders.map((h) => h.p), []);
});

test('ROB: QueryClient retry kapalı kalmalı (öngörülebilir hata yüzeyi; ADR-011)', () => {
  const app = read('App.tsx');
  assert.ok(/queries:\s*{[^}]*retry:\s*false/.test(app), 'queries.retry false değil');
  assert.ok(/mutations:\s*{[^}]*retry:\s*false/.test(app), 'mutations.retry false değil');
});

test('i18n: tr.json geçerli JSON + PHONE_ALREADY_EXISTS anahtarı mevcut', () => {
  const raw = read('i18n/locales/tr.json');
  const parsed = JSON.parse(raw); // throws on syntax error
  assert.ok(Object.keys(parsed).length > 0);
  assert.ok(raw.includes('"PHONE_ALREADY_EXISTS"'), 'telefon-çakışma çevirisi kaybolmuş');
});
