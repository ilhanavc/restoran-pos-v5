// Blok 1 audit findings — intentionally RED until bugs fixed. See docs/audit/01-shared-domain.md
import { describe, expect, it } from 'vitest';
import { sanitize } from './sanitizer.js';

/**
 * [SD-S-01] BLOCKER — `packages/db/migrations/000_init.sql:382` (call_logs
 * tablo yorumu): "§12 deny-list: raw_phone NEVER in audit payload." Ama:
 *  - TS `DENY_LIST` (deny-list.ts) `raw_phone` YOK, `phone_raw` da YOK.
 *  - DB CHECK constraint `audit_logs_payload_no_pii`
 *    (000_init.sql:368-378) `'phone_raw'` (TERS kelime sırası) listeler —
 *    gerçek kolon adı her yerde (`customer_phones.raw_phone`,
 *    `call_logs.raw_phone`) `raw_phone`'dur, `phone_raw` DEĞİL.
 * Sonuç: şemanın "ASLA audit payload'a girmez" dediği tam o anahtar adı,
 * NE TS sanitizer NE DE DB CHECK tarafından yakalanıyor. deny-list.ts'nin
 * kendi yorumu ("ADR-003 §12.2 ile senkron") da bu yüzden yanlış —
 * senkron değil.
 */
describe('[SD-S-01] DENY_LIST "raw_phone" içermiyor — şemanın "NEVER in audit payload" sözü TS katmanında tutulmuyor', () => {
  it('payload\'da "raw_phone" anahtarı PII olarak reddedilmeli (phone anahtarıyla aynı muamele)', () => {
    expect(() =>
      sanitize('auth.login', {
        success: true,
        raw_phone: '05321234560',
      } as unknown as Record<string, unknown>),
    ).toThrow('error.audit.piiDetected');
  });
});

/**
 * [SD-S-13] HIGH — DENY_LIST (TS) ile `audit_logs_payload_no_pii` DB CHECK
 * constraint'i (kanonik liste, decisions.md §12.2) arasında SD-S-01'in
 * ötesinde geniş bir drift var. DB listesinde olup TS listesinde OLMAYAN,
 * özellikle yüksek-olasılıklı İngilizce alan adları: `customer_name`
 * (musteri_adi'nin birebir İngilizce karşılığı — CLAUDE.md "kod içi
 * İngilizce" kuralı yüzünden musteri_adi'den DAHA olası bir gerçek anahtar
 * adı), `customer_phone` (musteri_telefon'un İngilizce karşılığı),
 * `session_token`, `iban`. Bu dört örnek TS DENY_LIST'te YOK; DB CHECK'te
 * VAR (yalnız top-level, nested/array'lerde DB de yakalamaz).
 */
describe('[SD-S-13] DENY_LIST — DB CHECK constraint\'in İngilizce alan adı varyantları eksik', () => {
  it.each(['customer_name', 'customer_phone', 'session_token', 'iban'])(
    '"%s" anahtarı DB CHECK\'te kanonik PII listesinde ama TS DENY_LIST\'te yok — sanitize() throw ETMELİ',
    (key) => {
      expect(() =>
        sanitize('auth.login', {
          success: true,
          [key]: 'hassas-deger',
        } as unknown as Record<string, unknown>),
      ).toThrow('error.audit.piiDetected');
    },
  );
});
