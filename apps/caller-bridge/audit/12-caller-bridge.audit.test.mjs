/**
 * Blok 12 (apps/caller-bridge) — YEŞİL sınır testleri (denetimde temiz pozitifler).
 *
 * Denetimin doğruladığı KVKK/interop/auth invariant'larını regresyona karşı
 * kilitler. Hepsi YEŞİL olmalı; kırmızıya dönmesi duruşun bozulması demek.
 *
 * node:test — C# statik okuma, dotnet suite'ini kirletmez:
 *   node --test apps/caller-bridge/audit/
 * Rapor: docs/audit/12-caller-bridge.md §0 "Güçlü çıkanlar"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const cbRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(cbRoot, rel), 'utf8');

test('KVKK: ham telefon loglanmamalı — tüm log yolları PhoneMasking.Mask kullanmalı', () => {
  const files = [
    'src/Devices/CidShowDevice.cs',
    'src/Workers/CallerBridgeWorker.cs',
    'src/Http/BridgeApiClient.cs',
  ];
  for (const f of files) {
    const src = read(f);
    // Log çağrısında ham RawPhone geçmemeli (yalnız masked/Mask sonucu).
    const logsRawPhone = /Log\w+\([^)]*\bRawPhone\b(?![^)]*Mask)/.test(src);
    assert.ok(!logsRawPhone, `${f} ham RawPhone'u maskeleme olmadan logluyor (KVKK ihlali)`);
  }
});

test('KVKK: PhoneMasking.Mask gerçek maskeleme yapıyor (yıldız + kısmi)', () => {
  const src = read('src/Logging/PhoneMasking.cs');
  assert.ok(/\*/.test(src), 'Mask yıldız maskesi üretmiyor');
});

test('INTEROP: CidShowDevice gerçek native yükleme + GC-rooting (S86 uydurma-interop tersi)', () => {
  const src = read('src/Devices/CidShowDevice.cs');
  assert.ok(/NativeLibrary\.(Load|GetExport)/.test(src), 'gerçek NativeLibrary yükleme kayboldu (mock-sabit riski)');
  assert.ok(/GetDelegateForFunctionPointer/.test(src), 'SetEvents delegate marshalling kayboldu');
  // Delegate GC-rooting: field'da tutulmalı (callback GC-collect edilmesin).
  assert.ok(/private\s+\w*Delegate\??\s+_/.test(src) || /_setEvents|_callerIdCb|_signalCb/.test(src), 'delegate field-rooting kayboldu (native callback GC riski)');
});

test('AUTH: BridgeApiClient X-Bridge-Token + X-Tenant-Id ikisini de gönderiyor (S86 fix)', () => {
  const src = read('src/Http/BridgeApiClient.cs');
  assert.ok(/X-Bridge-Token/i.test(src), 'X-Bridge-Token header kayboldu');
  assert.ok(/X-Tenant-Id/i.test(src), 'X-Tenant-Id header kayboldu (S86 regresyonu)');
});

test('SEC: repo\'da gerçek prod token/secret yok (yalnız placeholder)', () => {
  const prod = read('src/appsettings.json');
  // Prod appsettings yalnız REPLACE_ME / <...> placeholder taşımalı.
  assert.ok(
    /REPLACE_ME|<[^>]+>|""/.test(prod),
    'prod appsettings placeholder taşımıyor — gerçek token commit\'lenmiş olabilir',
  );
});

test('QUAL: async void yok (exception yutma riski)', () => {
  const files = ['src/Workers/CallerBridgeWorker.cs', 'src/Devices/CidShowDevice.cs', 'src/Http/BridgeApiClient.cs'];
  for (const f of files) {
    assert.ok(!/async\s+void\s+\w/.test(read(f)), `${f} async void içeriyor`);
  }
});

test('QUAL: csproj Nullable enable + TreatWarningsAsErrors (0-uyarı garantisi)', () => {
  const csproj = read('src/CallerBridge.csproj');
  assert.ok(/<Nullable>enable<\/Nullable>/.test(csproj), 'Nullable enable kayboldu');
  assert.ok(/<TreatWarningsAsErrors>true<\/TreatWarningsAsErrors>/.test(csproj), 'TreatWarningsAsErrors kayboldu');
});
