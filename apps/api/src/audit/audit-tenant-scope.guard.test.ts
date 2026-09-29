import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * ADR-041 Amd5 K6 — `writeAudit` TENANT-CONTEXT guard'ı (S134 güvenlik denetimi
 * bulgusu: CONCERN-4).
 *
 * `audit_logs` migration 063 ile force-RLS'lidir; INSERT policy'si
 * `tenant_id = current_setting('app.current_tenant_id')` **ve**
 * `tenant_id IS NOT NULL` ister. Yani her `writeAudit` çağrısı bir `withTenant`
 * transaction'ı içinde koşmalıdır — aksi halde **HTTP 500** (müşteri CRUD,
 * kullanıcı yönetimi, rapor CSV'leri anında durur).
 *
 * ⚠️ NEDEN BU GUARD GEREKLİ — tip sistemi bunu YAKALAMAZ: `writeAudit`'in imzası
 * `AuditExecutor = Kysely<DB> | Transaction<DB>` (`audit/writeAudit.ts:14`), yani
 * `writeAudit(deps.db, …)` **derlenir**, lint'ten geçer ve ancak prod'da patlar.
 * S134 envanterinde tam bu sınıftan 15 çağrı bulundu (`customers/index.ts` ×9,
 * `users.ts` ×4, `printers.ts` ×1, `csv-format-handler.ts` ×1). Mevcut
 * `audit-single-entry.guard.test.ts` yalnız `insertInto('audit_logs')` arıyor;
 * executor'ın nereden geldiğini kontrol etmiyor → o guard bu sınıfı kaçırır.
 *
 * Kapsam ve sınırı: bu test bir **grep guard**'dır, veri-akışı analizi değil.
 * `writeAudit(deps.db, …)` / `writeAudit(db, …)` gibi *bilinen kötü* desenleri
 * yakalar. `withTenant` dışında açılmış bir `trx` (düz `.transaction()`) hâlâ
 * geçebilir — S134'te `users.ts`/`printers.ts` tam olarak o tuzağa düşmüştü.
 * Gerçek kanıt hep negatif kontroldür (sarımı sök → app_tenant testi kırmızı);
 * bu guard yalnız en sık hatanın **sessizce geri gelmesini** engeller.
 * Tipi `Transaction<DB>`'e daraltmak (asıl çözüm) cron'un NULL-tenant yazımını
 * kırdığı için v5.1'e bırakıldı (Amd5, regresyon yüzeyi notu).
 *
 * MEŞRU İSTİSNA: `cron/ttl-cleanup.ts` — sistem-actor (`tenant_id: null`)
 * self-audit'i `withTenant` ile yazılamaz (helper geçersiz UUID'de transaction
 * açmaz); o yol `cron_purger` (BYPASSRLS) pool'uyla koşar. Amd5 K2 (env
 * fail-fast) + K3 (M5 boot-assertion) o pool'un doğruluğunu ayrıca garanti eder.
 */
describe('writeAudit tenant-context guard (ADR-041 Amd5 K6)', () => {
  it('hiçbir çağrı audit yazımında bare pool (deps.db / db) kullanmaz', () => {
    // import.meta.url → .../src/audit/<bu-dosya>; '..' → .../src
    const srcDir = fileURLToPath(new URL('..', import.meta.url));
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) out.push(...walk(p));
        // Test dosyaları hariç: birim testleri writeAudit'i düz db ile meşru
        // şekilde çağırır (RLS'siz fixture DB'si).
        else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
      }
      return out;
    };

    // writeAudit(deps.db, …) | writeAudit(db, …) | writeAudit(deps.pool, …)
    // Boşluk ve satır sonu toleranslı.
    const re = /writeAudit\(\s*(deps\.db|deps\.pool|db)\s*,/;

    const offenders: string[] = [];
    for (const file of walk(srcDir)) {
      const norm = file.replace(/\\/g, '/');
      // Meşru istisna: NULL-tenant sistem-actor self-audit (cron_purger pool).
      if (norm.endsWith('cron/ttl-cleanup.ts')) continue;
      if (re.test(readFileSync(file, 'utf8'))) offenders.push(norm);
    }

    // Boş olmalı. Kırmızıysa: o çağrıyı
    //   await withTenant(deps.db, tenantId, (trx) => writeAudit(trx, {...}))
    // biçimine al (ADR-041 Amd5 K4 deseni).
    expect(offenders).toEqual([]);
  });
});
