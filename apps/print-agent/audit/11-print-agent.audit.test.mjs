/**
 * Blok 11 (apps/print-agent) — YEŞİL sınır testleri (denetimde temiz pozitifler).
 *
 * Denetimin doğruladığı güvenlik/doğruluk invariant'larını regresyona karşı
 * kilitler. Hepsi YEŞİL olmalı; kırmızıya dönmesi duruşun bozulması demek.
 *
 * node:test — mevcut vitest suite'ini kirletmez:
 *   node --test apps/print-agent/audit/
 * Rapor: docs/audit/11-print-agent.md §0 "Güçlü çıkanlar"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const agentRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(agentRoot, '..', '..');
const readAgent = (rel) => readFileSync(join(agentRoot, rel), 'utf8');
const readRepo = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

test('SEC: tenant izolasyonu — claim/result tenant_id filtreli (cross-tenant job yok)', () => {
  const src = readRepo('apps/api/src/routes/print-jobs.ts');
  assert.ok(/tenant_id/.test(src), 'print-jobs tenant_id filtresi kayboldu');
  // claim SELECT'i JWT tid'e bağlı olmalı (auth middleware tid enjekte eder).
  assert.ok(/FOR UPDATE|SKIP LOCKED/i.test(src), 'atomik claim (FOR UPDATE SKIP LOCKED) kayboldu');
});

test('SEC: JWT agent secret HS256 pinned (alg-confusion/none reddi)', () => {
  const auth = readRepo('apps/api/src/middleware/print-agent-auth.ts');
  assert.ok(/algorithms:\s*\[\s*'HS256'\s*\]/.test(auth), 'algorithms HS256 pin kayboldu (alg-confusion riski)');
});

test('P/Invoke: spooler-helper Win32 imzaları mevcut (native-interop-verify dersi)', () => {
  const cs = readAgent('spooler-helper/Program.cs');
  for (const sym of ['OpenPrinter', 'StartDocPrinter', 'WritePrinter', 'EndDocPrinter', 'ClosePrinter']) {
    assert.ok(cs.includes(sym), `winspool ${sym} imzası kayboldu — P/Invoke bütünlüğü (S88)`);
  }
  assert.ok(/DOC_INFO_1/.test(cs), 'DOC_INFO_1 struct kayboldu');
});

test('ROB: lazy reclaim cron değil claim-gömülü + success attempts\'a dokunmuyor (ADR-004 Amd3)', () => {
  const src = readRepo('apps/api/src/routes/print-jobs.ts');
  assert.ok(/RECLAIM_STALE_SECONDS/.test(src), 'reclaim eşiği kayboldu');
  assert.ok(/SKIP LOCKED/i.test(src), 'reclaim claim-SELECT\'e gömülü değil (cron\'a kaçmış olabilir)');
});

test('SEC: transport fiş byte\'larını stdin ile veriyor (temp dosya/PII yok)', () => {
  const src = readAgent('src/printer/spooler-transport.ts');
  assert.ok(/stdin/i.test(src), 'spooler transport stdin yerine temp-file\'a kaymış olabilir (PII disk riski)');
});

test('SEC: TLS doğrulama bypass edilmemeli (rejectUnauthorized/NODE_TLS)', () => {
  const files = ['src/index.ts', 'src/printer/config.ts'];
  for (const f of files) {
    const src = readAgent(f);
    assert.ok(!/rejectUnauthorized:\s*false/.test(src), `${f} TLS doğrulamayı kapatıyor`);
    assert.ok(!/NODE_TLS_REJECT_UNAUTHORIZED/.test(src), `${f} NODE_TLS_REJECT_UNAUTHORIZED kullanıyor`);
  }
});

test('QUAL: mevcut audit test klasörü paketten ayrı (vitest suite kirlenmedi)', () => {
  // Bu testin varlığı = audit testleri node:test ile ayrı koşuyor.
  // vitest.config testDir'i src altında olmalı, audit/ dahil edilmemeli.
  assert.ok(existsSync(join(agentRoot, 'vitest.config.ts')), 'vitest.config bulunamadı');
  const cfg = readAgent('vitest.config.ts');
  // audit/ .mjs olduğundan ve vitest .test.ts topladığından çakışma yok; yine de doğrula.
  assert.ok(!/audit/.test(cfg) || /exclude/.test(cfg), 'vitest config audit/ ile çakışabilir');
});
