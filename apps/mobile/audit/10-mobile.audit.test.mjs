/**
 * Blok 10 (apps/mobile) — YEŞİL sınır testleri (denetimde temiz çıkan pozitifler).
 *
 * Denetimin doğruladığı güvenlik/dayanıklılık invariant'larını regresyona
 * karşı kilitler. Hepsi YEŞİL olmalı; kırmızıya dönmesi duruşun bozulması demek.
 *
 * Koşum: node --test apps/mobile/audit/
 * Rapor: docs/audit/10-mobile.md §0 "Güçlü çıkanlar"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFileSync(join(mobileRoot, 'src', rel), 'utf8');

const collect = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collect(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
};
const allSources = () =>
  collect(join(mobileRoot, 'src')).map((p) => ({ p, src: readFileSync(p, 'utf8') }));

test('SEC: token saklama yalnız expo-secure-store olmalı (AsyncStorage yasak)', () => {
  // Gerçek import/API kullanımı ara (yorumdaki "AsyncStorage" sözcüğü değil).
  const offenders = allSources().filter(({ src: s }) =>
    /from\s+['"]@react-native-async-storage|AsyncStorage\s*[.[]/.test(s),
  );
  assert.deepEqual(offenders.map((o) => o.p), []);
  assert.ok(src('store/auth.ts').includes('expo-secure-store'), 'auth store SecureStore kullanmıyor');
});

test('SEC: src içinde console.* olmamalı (PII log riski sıfır kalmalı)', () => {
  const offenders = allSources().filter(({ src: s }) => /console\.(log|error|warn|info|debug)\(/.test(s));
  assert.deepEqual(offenders.map((o) => o.p), []);
});

test('BUG: ödeme yolu idempotency + pending-kilidi korunmalı (ADR-014 §4)', () => {
  const sheet = src('features/payments/QuickPaySheet.tsx');
  assert.ok(/[Ii]dempotency/.test(sheet), 'QuickPaySheet idempotency key izi kayboldu');
  assert.ok(/isPending/.test(sheet), 'ödeme pending-kilidi kayboldu');
});

test('SEC: socket token handshake auth-payload ile taşınmalı (query-string yasak)', () => {
  const sock = src('realtime/socket.ts');
  assert.ok(/auth:/.test(sock), 'socket auth payload deseni kayboldu');
  assert.ok(!/query:\s*{[^}]*token/s.test(sock), 'token query-string\'e taşınmış — access log sızıntısı');
});

test('BUG: mock katmanı derleme-sabiti ile kapalı kalmalı (USE_MOCK=false)', () => {
  const config = src('config.ts');
  assert.ok(/USE_MOCK\s*=\s*false/.test(config), 'USE_MOCK sabiti false değil / kaldırılmış — mock prod\'a sızabilir');
});

test("QUAL: `any` tipi yasağı — mobil src'de any olmamalı (CLAUDE.md)", () => {
  const offenders = allSources().filter(({ src: s }) => /(:\s*any\b|as\s+any\b|<any>)/.test(s));
  assert.deepEqual(offenders.map((o) => o.p), []);
});

test('i18n: tr.json geçerli + çekirdek key\'ler mevcut (save-retry akışı)', () => {
  const tr = JSON.parse(src('i18n/locales/tr.json'));
  assert.ok(tr.order?.save?.error, 'order.save.error kayıp');
  assert.ok(tr.common?.retry, 'common.retry kayıp');
  assert.ok(tr.tables?.status?.cleaning, 'tables.status.cleaning kayıp');
});
