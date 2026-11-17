import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RECEIPT_TEXT } from '@restoran-pos/shared-domain';
import { logger } from '../logger.js';
import { resolveTenantReceiptText } from './receipt-text-settings.js';

/** ADR-045 K9 — enqueue tarafındaki fail-open + log sözleşmesi. */

const TENANT = '00000000-0000-4000-8000-0000000000aa';
const original = process.env['RECEIPT_TEXT_ENABLED'];

afterEach(() => {
  vi.restoreAllMocks();
  if (original === undefined) delete process.env['RECEIPT_TEXT_ENABLED'];
  else process.env['RECEIPT_TEXT_ENABLED'] = original;
});

describe('resolveTenantReceiptText', () => {
  it('satır yok (undefined) → bugünkü fiş, log yok', () => {
    const err = vi.spyOn(logger, 'error');
    expect(resolveTenantReceiptText(undefined, TENANT)).toBe(DEFAULT_RECEIPT_TEXT);
    expect(err).not.toHaveBeenCalled();
  });

  it('geçerli metin olduğu gibi döner, log yok', () => {
    const err = vi.spyOn(logger, 'error');
    const r = resolveTenantReceiptText(
      { receipt_header_lines: ['Tel: 0212 555 44 33'], receipt_footer_lines: [] },
      TENANT,
    );
    expect(r.header).toEqual(['Tel: 0212 555 44 33']);
    expect(r.footer).toEqual({ kind: 'custom', lines: [] });
    expect(err).not.toHaveBeenCalled();
  });

  it('🔴 bozuk değer → varsayılan + logger.error (tenant + sayaç), throw yok, METİN log\'a girmez', () => {
    const err = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);
    const secretish = 'Gizli\u001b@Adres';
    const r = resolveTenantReceiptText(
      { receipt_header_lines: [secretish], receipt_footer_lines: null },
      TENANT,
    );
    expect(r).toBe(DEFAULT_RECEIPT_TEXT);
    expect(err).toHaveBeenCalledTimes(1);
    const [fields] = err.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields).toEqual({ tenantId: TENANT, counter: 'receipt_text.invalid' });
    expect(JSON.stringify(err.mock.calls[0])).not.toContain('Gizli');
  });

  it('kill-switch kapalı (RECEIPT_TEXT_ENABLED=false) → kolonlar yok sayılır', () => {
    process.env['RECEIPT_TEXT_ENABLED'] = 'false';
    const r = resolveTenantReceiptText(
      { receipt_header_lines: ['Adres'], receipt_footer_lines: [] },
      TENANT,
    );
    expect(r).toBe(DEFAULT_RECEIPT_TEXT);
  });
});
