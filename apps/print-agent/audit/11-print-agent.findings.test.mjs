/**
 * Blok 11 (apps/print-agent) — KASITLI KIRMIZI bulgu testleri.
 *
 * Derin denetim serisi kuralı: HIGH/BLOCKER bulguları kilitler; fix'ler
 * (Blok 13) yapılana kadar KIRMIZI kalır. Assertion'lar DÜZELTİLMİŞ durumu
 * tarif eder — yeşile dönmesi = bulgu kapandı.
 *
 * node:test (.mjs) — mevcut vitest suite'ini (39/39) KİRLETMEZ; ayrı koşar:
 *   node --test apps/print-agent/audit/
 *
 * Rapor: docs/audit/11-print-agent.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const agentRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(agentRoot, rel), 'utf8');

// ── P11-A-01 (HIGH): reportResult fetch try/catch + main sarmalama ──────────
test('P11-A-01a: reportResult fetch ağ hatasını yakalamalı (crash → reclaim çift-baskı)', () => {
  const src = read('src/index.ts');
  const fn = src.split('async function reportResult')[1]?.split('\nasync function')[0] ?? '';
  // fetch çağrısından ÖNCEKİ gövde try ile açılmış olmalı (res.text().catch değil).
  const beforeFetch = fn.split('await fetch')[0] ?? '';
  assert.ok(
    /try\s*{/.test(beforeFetch),
    'reportResult fetch\'i korumasız (öncesinde try yok) — success-ack throw ederse job yanlış "failed" raporlanıp reclaim ile yeniden basılır (index.ts:203)',
  );
});

test('P11-A-01b: main() döngüsü pollOnce hatasını yutmalı (unhandled rejection = process crash)', () => {
  const src = read('src/index.ts');
  const mainBody = src.split('async function main')[1]?.split('\nvoid main')[0] ?? '';
  // Fix sonrası: refresh'i saran catch + pollOnce'ı saran catch = en az 2.
  // Şu an yalnız 1 (refresh); pollOnce çıplak (index.ts:432).
  const catchCount = (mainBody.match(/catch\s*[({]/g) ?? []).length;
  assert.ok(
    catchCount >= 2,
    `main() içinde ${catchCount} catch var — pollOnce çıplak; ack çift-throw'u main'den kaçıp unhandled rejection ile process'i çökertir (index.ts:432)`,
  );
});

test('P11-B-02: process.on(unhandledRejection/SIGTERM) handler\'ları kurulmalı', () => {
  const src = read('src/index.ts');
  assert.ok(
    /process\.on\(\s*['"](unhandledRejection|uncaughtException|SIGTERM|SIGINT)['"]/.test(src),
    'hiçbir process.on handler yok — boot-hataları ham stack basıp nssm restart-loop\'a giriyor',
  );
});

// ── P11-B-01 (HIGH): config BOM regresyonu ──────────────────────────────────
test('P11-B-01a: config loader BOM strip etmeli (PS5.1 UTF8 = BOM)', () => {
  const src = read('src/printer/config.ts');
  assert.ok(
    /\\ufeff|\\uFEFF|replace\(\s*\/\^\\u|stripBom|trimStart/.test(src) ||
      /replace\(/.test(src.split('JSON.parse')[0]?.split('readFileSync').pop() ?? ''),
    'config.ts BOM strip etmiyor — PS5.1 ile yazılmış BOM\'lu config JSON.parse\'ı patlatır (config.ts:91; S91 dersi regresyonu)',
  );
});

test('P11-B-01b: install-second-agent.ps1 BOM üretmemeli (PS7 zorla veya utf8NoBOM)', () => {
  const ps = read('installer/install-second-agent.ps1');
  const requiresV7 = /#Requires\s+-Version\s+7/i.test(ps);
  const noBomEncoding = !/Set-Content[^\n]*-Encoding\s+UTF8\b/i.test(ps) ||
    /utf8NoBOM/i.test(ps);
  assert.ok(
    requiresV7 || noBomEncoding,
    'script ne "#Requires -Version 7" ne utf8NoBOM kullanıyor → PS5.1\'de Set-Content -Encoding UTF8 BOM üretir (satır 139,150)',
  );
});

// ── P11-SEC-01 (HIGH): installer key komut satırından ───────────────────────
test('P11-SEC-01: install script key\'i shell history\'e düşürmemeli', () => {
  const ps = read('installer/install-second-agent.ps1');
  // Örneklerde literal pk_ key olmamalı; key SecureString/env'den gelmeli.
  const literalKeyInExample = /pk_[a-z0-9_]{6,}/i.test(ps);
  const securePattern = /AsSecureString|\$env:PRINT_AGENT_API_KEY/i.test(ps);
  assert.ok(
    !literalKeyInExample && securePattern,
    'key hâlâ düz -ApiKey argümanı / .EXAMPLE\'da literal — PSReadLine history + nssm registry plaintext (satır 82,176)',
  );
});

// ── P11-A-03 (HIGH): backoff ────────────────────────────────────────────────
test('P11-A-03: ağ hatasında backoff olmalı (cloud kesintisinde hot-loop)', () => {
  const src = read('src/index.ts');
  assert.ok(
    /backoff|setTimeout|sleep|delay|Math\.min\([^)]*attempt/i.test(src),
    'fetch-fail sonrası bekleme yok — cloud unreachable\'da hot-loop (CPU + log-flood → C: disk)',
  );
});

// ── P11-B-03 (MEDIUM): MSI versiyon drift ───────────────────────────────────
test('P11-B-03: WiX Version build-time enjekte edilmeli (hardcoded drift riski)', () => {
  const wxs = read('installer/print-agent.wxs');
  assert.ok(
    !/Version="0\.0\.2"/.test(wxs),
    'wxs Version="0.0.2" hardcoded; package.json bump\'ında MSI upgrade sessiz no-op riski (S83 sınıfı)',
  );
});
