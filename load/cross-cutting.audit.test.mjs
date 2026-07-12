/**
 * Blok 13-A — Cross-cutting YEŞİL invariant testleri (repo-geneli pozitifler).
 *
 * Denetimin doğruladığı repo-geneli güvenlik/kalite invariantlarını regresyona
 * karşı kilitler. Hepsi YEŞİL olmalı; kırmızıya dönmesi duruşun bozulması demek.
 *
 * Saf statik-kaynak analizi (DB/API/derleme gerekmez):
 *   node --test load/cross-cutting.audit.test.mjs
 * Rapor: docs/audit/00-summary.md §4
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git' || name === 'audit') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const prodSources = () =>
  [join(repoRoot, 'apps'), join(repoRoot, 'packages')]
    .flatMap((d) => walk(d))
    .map((p) => ({ p, src: readFileSync(p, 'utf8') }));

test('CC-1: prod kaynakta gerçek `any` olmamalı (yorum-satırı hariç)', () => {
  const offenders = [];
  for (const { p, src } of prodSources()) {
    for (const line of src.split('\n')) {
      const trimmed = line.trim();
      // Yorum satırlarını atla: JSDoc devamı (* ...), // ve /* açılışı.
      if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      if (/(:\s*any\b|as\s+any\b|<any>|@ts-ignore|@ts-nocheck)/.test(code)) offenders.push(`${p}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `prod'da any/@ts-ignore: ${offenders.join(' | ')}`);
});

test('CC-2: parasal alan float storage olmamalı (float sütun/parse yok)', () => {
  // NUMERIC/DECIMAL para sütunu veya parseFloat(...cents) ihlali ara.
  const offenders = [];
  for (const { p, src } of prodSources()) {
    if (/parseFloat\([^)]*(cents|amount|price|total)/i.test(src)) offenders.push(`${p} (parseFloat on money)`);
  }
  assert.deepEqual(offenders, [], `para float-parse: ${offenders.join(' | ')}`);
});

test('CC-3: .env dosyası git\'te tracked OLMAMALI (yalnız .example)', () => {
  const tracked = execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /(^|\/)\.env$/.test(f) || /\.env\.(local|production|prod)$/.test(f));
  assert.deepEqual(tracked, [], `tracked .env: ${tracked.join(', ')}`);
});

test('CC-4: prod kaynakta hardcoded canlı secret olmamalı', () => {
  const offenders = [];
  for (const { p, src } of prodSources()) {
    for (const m of src.matchAll(/(SECRET|API_KEY|BRIDGE_TOKEN|PASSWORD)\s*[:=]\s*['"]([A-Za-z0-9+/]{20,})['"]/g)) {
      const val = m[2];
      if (!/REPLACE_ME|placeholder|example|xxxx/i.test(val)) offenders.push(`${p}: ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, [], `hardcoded secret: ${offenders.join(' | ')}`);
});

test('CC-5: yük harness prod-guard localhost dışını reddetmeli', () => {
  const harness = readFileSync(join(repoRoot, 'load', 'run-load.mjs'), 'utf8');
  assert.ok(/localhost|127\.0\.0\.1/.test(harness) && /REDDEDILDI|process\.exit\(1\)/.test(harness),
    'run-load.mjs BASE_URL guard\'ı kaybolmuş — prod\'a yük testi riski');
});
