import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * VERI-6 (satın-alma DD triyajı, kova A) — `audit_logs` TEK-GİRİŞ guard'ı.
 *
 * Tüm `audit_logs` INSERT'leri `audit/writeAudit.ts` üzerinden geçmeli.
 * writeAudit, özyinelemeli `sanitize` (shared-domain/audit/sanitizer.ts) çağırır:
 * deny-list'teki PII (İÇ-İÇE dahil) yazımdan ÖNCE `error.audit.piiDetected` ile
 * reddedilir + whitelist-dışı anahtarlar düşürülür.
 *
 * DB CHECK `audit_logs_payload_no_pii` (000_init:367) yalnız TOP-LEVEL anahtar
 * tarar (`payload ?| ARRAY[...]`) — iç-içe `payload.data.phone` gibi PII'yi
 * yakalamaz. Yani iç-içe-PII'nin ASIL koruması bu tek-giriş + özyinelemeli
 * sanitizer'dır; DB CHECK yalnız ikincil emniyet ağıdır.
 *
 * Bu guard, gelecekte biri doğrudan `insertInto('audit_logs')` ekleyip
 * sanitizer'ı atlamasını (→ iç-içe PII sızıntısı) engeller. writeAudit.ts'teki
 * "CI grep guard enforces this" yorumunu GERÇEK kılan testtir.
 */
describe('audit_logs tek-giriş noktası (VERI-6 guard)', () => {
  it('yalnız audit/writeAudit.ts doğrudan audit_logs INSERT eder', () => {
    // import.meta.url → .../src/audit/<bu-dosya>; '..' → .../src
    const srcDir = fileURLToPath(new URL('..', import.meta.url));
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) out.push(...walk(p));
        // Test dosyaları hariç: fixture'lar meşru şekilde audit_logs seed'leyebilir.
        else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
      }
      return out;
    };
    // insertInto('audit_logs') | insertInto("audit_logs") — boşluk toleranslı.
    const re = /insertInto\(\s*['"]audit_logs['"]\s*\)/;
    const offenders: string[] = [];
    for (const file of walk(srcDir)) {
      const norm = file.replace(/\\/g, '/');
      if (norm.endsWith('audit/writeAudit.ts')) continue; // tek meşru giriş
      if (re.test(readFileSync(file, 'utf8'))) offenders.push(norm);
    }
    expect(offenders).toEqual([]);
  });
});
