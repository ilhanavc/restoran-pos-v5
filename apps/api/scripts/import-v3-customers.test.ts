/**
 * import-v3-customers unit testleri.
 *
 * Excel okuma + DB connection mock'lanır; sadece pure transform + counter
 * davranışı doğrulanır.
 */
import { describe, it, expect } from 'vitest';
import { sanitize } from '@restoran-pos/shared-domain';
import {
  buildImportAuditPayload,
  cleanRawPhone,
  emptyReport,
  importParsedRows,
  parseCliArgs,
  type ImportExecutor,
  type ParsedRow,
} from './import-v3-customers.js';

function makeRow(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    legacyV3No: 1,
    fullName: 'Ali Veli',
    rawPhone: '5324428712',
    normalizedPhone: '05324428712',
    isMobile: true,
    district: null,
    addressLine: null,
    totalOrders: 5,
    ...overrides,
  };
}

function makeMockExecutor(opts: {
  customerInsertedFor?: Set<number | null>;
  phoneInsertedFor?: Set<string>;
  customerCalls?: number[];
  phoneCalls?: string[];
  addressCalls?: string[];
}): ImportExecutor {
  const customerInsertedFor = opts.customerInsertedFor ?? new Set();
  const phoneInsertedFor = opts.phoneInsertedFor ?? new Set();
  return {
    async insertCustomer(args) {
      opts.customerCalls?.push(args.legacyV3No ?? -1);
      const inserted = customerInsertedFor.has(args.legacyV3No);
      return { inserted };
    },
    async insertPhone(args) {
      opts.phoneCalls?.push(args.normalizedPhone);
      const inserted = phoneInsertedFor.has(args.normalizedPhone);
      return { inserted };
    },
    async insertAddress(args) {
      opts.addressCalls?.push(args.addressLine);
    },
    async findCustomerIdByLegacyNo() {
      return null;
    },
  };
}

describe('parseCliArgs', () => {
  it('zorunlu argümanları parse eder', () => {
    const args = parseCliArgs([
      '--tenant',
      '11111111-1111-1111-1111-111111111111',
      '--file',
      '/tmp/x.xlsx',
    ]);
    expect(args.tenant).toBe('11111111-1111-1111-1111-111111111111');
    expect(args.file).toBe('/tmp/x.xlsx');
    expect(args.dryRun).toBe(false);
    expect(args.batch).toBe(100);
  });

  it('--dry-run + --batch alır', () => {
    const args = parseCliArgs([
      '--tenant',
      't',
      '--file',
      'f',
      '--dry-run',
      '--batch',
      '50',
    ]);
    expect(args.dryRun).toBe(true);
    expect(args.batch).toBe(50);
  });

  it('--tenant yoksa hata fırlatır', () => {
    expect(() => parseCliArgs(['--file', 'f'])).toThrow(/--tenant/);
  });

  it('--file yoksa hata fırlatır', () => {
    expect(() => parseCliArgs(['--tenant', 't'])).toThrow(/--file/);
  });

  it('--batch sayısal olmayanı reddeder', () => {
    expect(() =>
      parseCliArgs(['--tenant', 't', '--file', 'f', '--batch', 'abc']),
    ).toThrow(/positive integer/);
  });
});

describe('cleanRawPhone', () => {
  it('null/undefined/boş için boş string döner', () => {
    expect(cleanRawPhone(null)).toBe('');
    expect(cleanRawPhone(undefined)).toBe('');
    expect(cleanRawPhone('')).toBe('');
    expect(cleanRawPhone('   ')).toBe('');
  });

  it('normal string aynen kalır', () => {
    expect(cleanRawPhone('5324428712')).toBe('5324428712');
    expect(cleanRawPhone('05324428712')).toBe('05324428712');
  });

  it('Excel float64 ".0" trailing\'ini siler', () => {
    expect(cleanRawPhone('905056632792.0')).toBe('905056632792');
    expect(cleanRawPhone(905056632792)).toBe('905056632792');
  });

  it('exponential notation\'ı çevirir', () => {
    expect(cleanRawPhone('5.056632792e+10')).toBe('50566327920');
  });

  it('7 hane sabit hat aynen kalır', () => {
    expect(cleanRawPhone('5288300')).toBe('5288300');
  });
});

describe('importParsedRows — counter davranışı', () => {
  it('inserted müşteri + telefon + adres counter\'ları artar', async () => {
    const report = emptyReport();
    const executor = makeMockExecutor({
      customerInsertedFor: new Set([1]),
      phoneInsertedFor: new Set(['05324428712']),
    });
    await importParsedRows({
      tenantId: 't',
      rows: [
        makeRow({
          addressLine: 'Atatürk Cad. No:5',
          district: 'Merkez',
        }),
      ],
      executor,
      report,
    });
    expect(report.customersInserted).toBe(1);
    expect(report.phonesInserted).toBe(1);
    expect(report.addressesInserted).toBe(1);
    expect(report.customersSkippedAlreadyExists).toBe(0);
  });

  it('idempotent: zaten mevcut müşteri için tel/adres atlanır', async () => {
    const report = emptyReport();
    const executor = makeMockExecutor({
      // hiçbir customer "inserted" değil → conflict
      customerInsertedFor: new Set(),
    });
    await importParsedRows({
      tenantId: 't',
      rows: [
        makeRow({
          addressLine: 'Atatürk Cad. No:5',
        }),
      ],
      executor,
      report,
    });
    expect(report.customersInserted).toBe(0);
    expect(report.customersSkippedAlreadyExists).toBe(1);
    expect(report.phonesInserted).toBe(0);
    expect(report.addressesInserted).toBe(0);
  });

  it('boş telefon → phonesSkippedEmpty++', async () => {
    const report = emptyReport();
    const executor = makeMockExecutor({
      customerInsertedFor: new Set([2]),
    });
    await importParsedRows({
      tenantId: 't',
      rows: [
        makeRow({
          legacyV3No: 2,
          rawPhone: '',
          normalizedPhone: '',
          isMobile: false,
        }),
      ],
      executor,
      report,
    });
    expect(report.customersInserted).toBe(1);
    expect(report.phonesSkippedEmpty).toBe(1);
    expect(report.phonesInserted).toBe(0);
  });

  it('duplicate telefon → phonesSkippedDuplicate++', async () => {
    const report = emptyReport();
    const executor = makeMockExecutor({
      customerInsertedFor: new Set([3]),
      phoneInsertedFor: new Set(), // hiçbir tel "inserted" değil
    });
    await importParsedRows({
      tenantId: 't',
      rows: [makeRow({ legacyV3No: 3 })],
      executor,
      report,
    });
    expect(report.customersInserted).toBe(1);
    expect(report.phonesInserted).toBe(0);
    expect(report.phonesSkippedDuplicate).toBe(1);
  });

  it('legacy_v3_no null olan satır da işlenir', async () => {
    const report = emptyReport();
    const executor = makeMockExecutor({
      customerInsertedFor: new Set([null]),
      phoneInsertedFor: new Set(['05324428712']),
    });
    await importParsedRows({
      tenantId: 't',
      rows: [makeRow({ legacyV3No: null })],
      executor,
      report,
    });
    expect(report.customersInserted).toBe(1);
  });

  it('birden çok satır kümülatif sayılır', async () => {
    const report = emptyReport();
    const executor = makeMockExecutor({
      customerInsertedFor: new Set([10, 11]),
      phoneInsertedFor: new Set(['05324428712', '05551234567']),
    });
    await importParsedRows({
      tenantId: 't',
      rows: [
        makeRow({ legacyV3No: 10 }),
        makeRow({
          legacyV3No: 11,
          rawPhone: '5551234567',
          normalizedPhone: '05551234567',
        }),
      ],
      executor,
      report,
    });
    expect(report.customersInserted).toBe(2);
    expect(report.phonesInserted).toBe(2);
  });
});

describe('buildImportAuditPayload — KVKK denetim payload (#8)', () => {
  it('sayaçları maplenir; errors = geçersiz isim + geçersiz No', () => {
    const r = emptyReport();
    r.totalRows = 100;
    r.customersInserted = 90;
    r.customersSkippedInvalidName = 3;
    r.customersSkippedInvalidLegacyNo = 2;
    r.customersSkippedAlreadyExists = 5; // dedup — errors'a DAHİL DEĞİL
    expect(buildImportAuditPayload(r)).toEqual({
      total_rows: 100,
      created: 90,
      errors: 5,
    });
  });

  it('yalnız sayaç anahtarları — PII kolonu yok', () => {
    const payload = buildImportAuditPayload(emptyReport());
    expect(Object.keys(payload).sort()).toEqual([
      'created',
      'errors',
      'total_rows',
    ]);
  });

  it('sanitize whitelist + PII deny-list temiz (uçtan uca)', () => {
    const r = emptyReport();
    r.totalRows = 10;
    r.customersInserted = 8;
    r.customersSkippedInvalidName = 2;
    const clean = sanitize(
      'customer_import.completed',
      buildImportAuditPayload(r),
      () => {},
    );
    expect(clean).toEqual({ total_rows: 10, created: 8, errors: 2 });
  });
});
