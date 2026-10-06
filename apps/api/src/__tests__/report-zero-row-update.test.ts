import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportIfNoRowsUpdated } from '../observability/reportZeroRowUpdate.js';
import { captureError } from '../observability/sentry.js';
import { logger } from '../logger.js';

/**
 * ADR-041 Amendment 7 **Düzeltme 1 (3b)** — `rowCount === 0` dedektörü.
 *
 * ⚠️ BU TEST, Amd7'nin ORİJİNAL kabul kriteri 11'inin YERİNE geçer.
 * Kriter 11, bugün geçmesi mümkün olmayan bir davranışı tarif ediyordu:
 * *"sarım sökülünce `42501` fırlar ve `catch` dalı Sentry'ye bildirir."*
 * Ampirik ölçüm bunun yanlış olduğunu gösterdi — force-RLS altında
 * context'siz UPDATE **hata fırlatmaz**, `USING` yüklemi satırı görünmez
 * kılar ve komut `rowCount=0` ile BAŞARIYLA döner (`42501` yalnız
 * `WITH CHECK` ihlalinde / eksik GRANT'te gelir). Kriter bu yüzden ikiye
 * ayrıldı:
 *   (a) **0 satır** → bu dosya (dedektör dalı)
 *   (b) **fırlatılan hata** → K5'in `catch` dalı (bağlantı/GRANT/deadlock);
 *       davranışı mevcut testlerde zaten kapsanıyor.
 *
 * Sentry kanalı mock'lanır (Amd6 K4 + single-tenant-guard.test.ts deseni):
 * alarmın yalnız üretildiğini değil **gerçekten Sentry'ye bildirildiğini** de
 * doğrulamak için.
 */
vi.mock('../observability/sentry.js', () => ({
  captureError: vi.fn(),
}));

const AGENT_ID = '11111111-2222-3333-4444-555555555555';

describe('reportIfNoRowsUpdated — rowCount===0 dedektörü (ADR-041 Amd7 Düzeltme 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('0 satır güncellendiğinde ALARM ÜRETİR (logger.error + captureError)', () => {
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);

    const fired = reportIfNoRowsUpdated([{ numUpdatedRows: 0n }], {
      site: '[print-agent-auth] last_seen_at',
      agentId: AGENT_ID,
    });

    expect(fired).toBe(true);
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1);

    // Sentry'ye giden mesaj: siteyi ve ADR referansını taşımalı ki issue
    // gruplaması anlamlı olsun ve operatör nereye bakacağını bilsin.
    const sent = vi.mocked(captureError).mock.calls[0]?.[0];
    expect(sent).toBeInstanceOf(Error);
    expect((sent as Error).message).toContain('last_seen_at');
    expect((sent as Error).message).toContain('Amd7 Düzeltme 1');

    // 🔒 PII sınırı (S135 güvenlik denetimi): agentId YALNIZ yerel pino
    // log'una gider, Sentry event'ine DEĞİL.
    expect((sent as Error).message).not.toContain(AGENT_ID);
    expect(errSpy.mock.calls[0]?.[0]).toMatchObject({ agentId: AGENT_ID });

    errSpy.mockRestore();
  });

  it('1 satır güncellendiğinde SUSAR (sağlıklı yol — yanlış pozitif üretmez)', () => {
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);

    const fired = reportIfNoRowsUpdated([{ numUpdatedRows: 1n }], {
      site: '[print-jobs] declared_kinds',
      agentId: AGENT_ID,
    });

    expect(fired).toBe(false);
    expect(captureError).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();

    errSpy.mockRestore();
  });

  it('boş sonuç dizisi de 0 sayılır (sürücü hiç satır döndürmezse sessiz kalmaz)', () => {
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);

    const fired = reportIfNoRowsUpdated([], {
      site: '[print-jobs] declared_kinds',
      agentId: AGENT_ID,
    });

    expect(fired).toBe(true);
    expect(captureError).toHaveBeenCalledTimes(1);

    errSpy.mockRestore();
  });

  it('birden çok satır güncellenirse de SUSAR (yalnız 0 alarm sebebidir)', () => {
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);

    const fired = reportIfNoRowsUpdated([{ numUpdatedRows: 3n }], {
      site: '[print-agent-auth] last_seen_at',
      agentId: AGENT_ID,
    });

    expect(fired).toBe(false);
    expect(captureError).not.toHaveBeenCalled();

    errSpy.mockRestore();
  });
});
