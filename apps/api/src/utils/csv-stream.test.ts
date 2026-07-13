import { describe, expect, it, vi } from 'vitest';
import {
  buildCsv,
  buildCsvFilename,
  csvEscape,
  csvRow,
  sendCsv,
} from './csv-stream.js';

describe('csvEscape', () => {
  it('düz string → as-is (escape yok)', () => {
    expect(csvEscape('hello')).toBe('hello');
  });

  // Formula-injection regresyonu — denetim R7-CSV-01 (00-summary §2.6):
  // kullanıcı-girdisi string Excel/Sheets'te formül olarak çalışmamalı.
  describe('formula-injection nötrleme (R7-CSV-01)', () => {
    it.each([
      ['=SUM(A1:A9)', "'=SUM(A1:A9)"],
      ['+HYPERLINK("http://x")', `"'+HYPERLINK(""http://x"")"`],
      ['-2+3+cmd|/c calc', "'-2+3+cmd|/c calc"],
      ['@yemek', "'@yemek"],
      ['\tsekmeyle', "'\tsekmeyle"],
    ])('tehlikeli ilk karakter %s → apostrof prefix', (input, expected) => {
      expect(csvEscape(input)).toBe(expected);
    });

    it('typed number negatif değer DOKUNULMAZ (rapor kolonları bozulmaz)', () => {
      expect(csvEscape(-5)).toBe('-5');
      expect(csvEscape(-12.5)).toBe('-12.5');
    });

    it('ortada = içeren string dokunulmaz (yalnız ilk karakter tehlikeli)', () => {
      expect(csvEscape('Pide = lezzet')).toBe('Pide = lezzet');
    });

    it('prefix sonrası RFC 4180 quoting kuralı hâlâ uygulanır', () => {
      expect(csvEscape('=A1;B1')).toBe(`"'=A1;B1"`);
    });
  });

  it('delimiter ; içeren değer → quote', () => {
    expect(csvEscape('a;b')).toBe('"a;b"');
  });

  it('quote içeren değer → quote + double-escape', () => {
    expect(csvEscape('a"b')).toBe('"a""b"');
  });

  it('newline (LF) içeren değer → quote', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('CR içeren değer → quote', () => {
    expect(csvEscape('line1\rline2')).toBe('"line1\rline2"');
  });

  it('null → boş string', () => {
    expect(csvEscape(null)).toBe('');
  });

  it('undefined → boş string', () => {
    expect(csvEscape(undefined)).toBe('');
  });

  it('number → toString', () => {
    expect(csvEscape(123)).toBe('123');
  });

  it('boolean true/false → ham string', () => {
    expect(csvEscape(true)).toBe('true');
    expect(csvEscape(false)).toBe('false');
  });

  it('Date → ISO 8601', () => {
    const d = new Date('2026-05-11T10:30:00Z');
    expect(csvEscape(d)).toBe('2026-05-11T10:30:00.000Z');
  });

  it('quote + delimiter karışımı → her iki kuralı uygula', () => {
    expect(csvEscape('a";b')).toBe('"a"";b"');
  });
});

describe('csvRow', () => {
  it('üç hücre → ; ile join + CRLF', () => {
    expect(csvRow(['a', 'b', 'c'])).toBe('a;b;c\r\n');
  });

  it('quote/delimiter karışımı → her hücre escape', () => {
    expect(csvRow(['a', 'b;c', 'd"e'])).toBe('a;"b;c";"d""e"\r\n');
  });

  it('boş array → sadece CRLF', () => {
    expect(csvRow([])).toBe('\r\n');
  });

  it('null değerler → boş hücre', () => {
    expect(csvRow([null, 'x', null])).toBe(';x;\r\n');
  });
});

describe('buildCsv', () => {
  it('header + 2 row → BOM + header satırı + body', () => {
    const result = buildCsv(['name', 'qty'] as const, [
      { name: 'Pide', qty: 3 },
      { name: 'Çay', qty: 5 },
    ]);
    expect(result).toBe('﻿name;qty\r\nPide;3\r\nÇay;5\r\n');
  });

  it('boş row listesi → BOM + sadece header', () => {
    const result = buildCsv(['col1', 'col2'] as const, []);
    expect(result).toBe('﻿col1;col2\r\n');
  });

  it('row eksik key → boş hücre', () => {
    const result = buildCsv<{ a: string; b: string }>(
      ['a', 'b'] as const,
      [{ a: 'x' } as { a: string; b: string }],
    );
    expect(result).toBe('﻿a;b\r\nx;\r\n');
  });

  it('header sırası kolonları belirler', () => {
    const result = buildCsv(['b', 'a'] as const, [{ a: '1', b: '2' }]);
    expect(result).toBe('﻿b;a\r\n2;1\r\n');
  });
});

describe('buildCsvFilename', () => {
  it('UTC ts + Europe/Istanbul (UTC+3 yaz) → yerel saatte format', () => {
    // 2026-05-11 11:30:22 UTC → 14:30:22 Istanbul
    const ts = new Date('2026-05-11T11:30:22Z');
    expect(
      buildCsvFilename({
        reportName: 'category-sales',
        tenantSlug: 'acme',
        timestamp: ts,
        timezone: 'Europe/Istanbul',
      }),
    ).toBe('category-sales-acme-2026-05-11-143022.csv');
  });

  it('UTC TZ → ts olduğu gibi format', () => {
    const ts = new Date('2026-01-15T08:05:09Z');
    expect(
      buildCsvFilename({
        reportName: 'daily-close',
        tenantSlug: 'pide-evi',
        timestamp: ts,
        timezone: 'UTC',
      }),
    ).toBe('daily-close-pide-evi-2026-01-15-080509.csv');
  });

  it('reportName + slug aynen kullanılır (kebab-case input expected)', () => {
    const ts = new Date('2026-05-11T11:30:22Z');
    const out = buildCsvFilename({
      reportName: 'user-performance',
      tenantSlug: 'lokanta-1',
      timestamp: ts,
      timezone: 'UTC',
    });
    expect(out).toContain('user-performance-lokanta-1-');
    expect(out.endsWith('.csv')).toBe(true);
  });
});

describe('sendCsv', () => {
  it('Content-Type, Disposition, Cache-Control header + body 200', () => {
    const setHeader = vi.fn();
    const status = vi.fn().mockReturnThis();
    const send = vi.fn();
    const res = { setHeader, status, send } as unknown as Parameters<
      typeof sendCsv
    >[0];

    sendCsv(res, 'report.csv', '﻿col\r\nval\r\n');

    expect(setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv; charset=utf-8',
    );
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="report.csv"',
    );
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(status).toHaveBeenCalledWith(200);
    expect(send).toHaveBeenCalledWith('﻿col\r\nval\r\n');
  });

  it('filename içindeki quote karakteri strip edilir', () => {
    const setHeader = vi.fn();
    const status = vi.fn().mockReturnThis();
    const send = vi.fn();
    const res = { setHeader, status, send } as unknown as Parameters<
      typeof sendCsv
    >[0];

    sendCsv(res, 'rep"ort.csv', 'x');

    expect(setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="report.csv"',
    );
  });
});
