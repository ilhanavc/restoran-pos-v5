/**
 * Blok 12 (apps/caller-bridge) — KASITLI KIRMIZI bulgu testleri.
 *
 * Derin denetim serisi kuralı: HIGH/MEDIUM bulguları kilitler; fix'ler
 * (Blok 13) yapılana kadar KIRMIZI kalır. Assertion'lar DÜZELTİLMİŞ durumu
 * tarif eder — yeşile dönmesi = bulgu kapandı.
 *
 * node:test (.mjs) — C# kaynağını STATİK okur; dotnet suite'ini (12/12) KİRLETMEZ:
 *   node --test apps/caller-bridge/audit/
 *
 * Rapor: docs/audit/12-caller-bridge.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const cbRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(cbRoot, rel), 'utf8');

// ── C12-ROB-01 (HIGH): StartAsync try/catch dışı ────────────────────────────
test('C12-ROB-01: Worker StartAsync interop-throw\'una karşı korunmalı', () => {
  const src = read('src/Workers/CallerBridgeWorker.cs');
  const exec = src.split('ExecuteAsync')[1] ?? '';
  // StartAsync çağrısından ÖNCE try açılmış olmalı (şu an try foreach'ten sonra).
  const beforeStart = exec.split('StartAsync')[0] ?? '';
  assert.ok(
    /try\s*{/.test(beforeStart),
    'StartAsync try/catch dışında — interop-throw ExecuteAsync\'i fault edip StopHost ile servisi sessizce durdurur (CallerBridgeWorker.cs:37)',
  );
});

// ── C12-B-01 (HIGH): USB kopma toparlanması ─────────────────────────────────
test('C12-B-01: signal callback kopma-algılama/health için kullanılmalı (No-op değil)', () => {
  const src = read('src/Devices/CidShowDevice.cs');
  // OnSignal metod gövdesini izole al (tek-seviye {} gövdesi).
  const m = src.match(/private\s+void\s+OnSignal\([^)]*\)\s*\{([^}]*)\}/);
  const body = m ? m[1] : '';
  assert.ok(
    body !== '' && !/No-op/.test(body) && /_logger|health|reconnect|Reconnect|_lastSignal|_lastCall/.test(body),
    'OnSignal tamamen No-op ("pilot scope") — USB kopma algılanmıyor, köprü kalıcı sağır kalır (CidShowDevice.cs:143)',
  );
});

// ── C12-B-03 (MEDIUM): düşen-çağrı observability ────────────────────────────
test('C12-B-03: başarısız POST metrik/sayaç ile görünür olmalı (best-effort kabul ama sessiz)', () => {
  const worker = read('src/Workers/CallerBridgeWorker.cs');
  // PostIncomingAsync bool dönüşü şu an yutuluyor; fix: dönüşü kullan (sayaç/log).
  assert.ok(
    /var\s+\w+\s*=\s*await\s+_api\.PostIncomingAsync|PostIncomingAsync\([^)]*\)\s*;\s*\n[^\n]*(?:if|_dropped|_failed|counter|Metric)/.test(worker),
    'PostIncomingAsync bool dönüşü Worker\'da yutuluyor — düşen çağrı görünmez (CallerBridgeWorker.cs:46)',
  );
});

// ── C12-A-05 (MEDIUM): https zorlama ────────────────────────────────────────
test('C12-A-05: BridgeApiClient localhost-dışı http\'yi reddetmeli', () => {
  const src = read('src/Http/BridgeApiClient.cs');
  assert.ok(
    /https|StartsWith\("https|Scheme|IsLoopback/.test(src),
    'ApiBaseUrl şema doğrulaması yok — http:// misconfig\'de token+ham PII cleartext (BridgeApiClient.cs:35)',
  );
});

// ── C12-A-06 (MEDIUM): endpoint startup log ─────────────────────────────────
test('C12-A-06: çözülen endpoint startup\'ta loglanmalı (S86 /api-prefix regresyon guard)', () => {
  const src = read('src/Http/BridgeApiClient.cs');
  const ctor = src.split('public BridgeApiClient')[1]?.split('public ')[0] ?? '';
  assert.ok(
    /Log(Information|Debug).*(?:endpoint|BaseAddress|url|Url|adres)/i.test(ctor),
    'çözülen tam endpoint startup\'ta loglanmıyor — /api prefix yanlışsa her POST 404, sessiz (S86 tekrar riski)',
  );
});

// ── C12-B-04 (MEDIUM): HttpClient factory lifetime ──────────────────────────
test('C12-B-04: HttpClient DNS-recycle korunmalı (singleton yakalama değil)', () => {
  const program = read('src/Program.cs');
  assert.ok(
    /PooledConnectionLifetime|SetHandlerLifetime|CreateClient/.test(program),
    'tipli HttpClient tek singleton\'da yakalanmış → IHttpClientFactory DNS-recycle devre-dışı (Program.cs:40)',
  );
});

// ── C12-C-01 (LOW): format whitespace ───────────────────────────────────────
test('C12-C-01: PhoneMaskingTests.cs InlineData whitespace düzeltilmeli', () => {
  const src = read('tests/PhoneMaskingTests.cs');
  assert.ok(
    !/InlineData\([^)]*\s{2,}[^)]*\)/.test(src),
    'InlineData\'da çift boşluk — dotnet format --verify-no-changes kırmızı (PhoneMaskingTests.cs:11)',
  );
});
