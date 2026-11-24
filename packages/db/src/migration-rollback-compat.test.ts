import { describe, expect, it } from 'vitest';
import { checkRollbackCompat, classifyMigration } from './migration-rollback-compat.js';

const sql = (header: string): string => `${header}\nCREATE TABLE x (id int);\n`;

describe('classifyMigration (ADR-047 K5.2)', () => {
  it('treats ≤072 files as unlabelled legacy breaking, even without a label', () => {
    const r = classifyMigration({ name: '072_tenant_settings_receipt_text.sql', content: sql('-- no label') });
    expect(r).toEqual({ name: '072_tenant_settings_receipt_text.sql', compat: 'breaking', legacy: true, error: null });
  });

  it('accepts additive and breaking labels on 073+', () => {
    expect(classifyMigration({ name: '073_a.sql', content: sql('-- rollback-compat: additive') }).compat).toBe('additive');
    expect(classifyMigration({ name: '074_b.sql', content: sql('-- x\n-- rollback-compat: breaking') }).compat).toBe('breaking');
  });

  it('accepts CRLF line endings', () => {
    const r = classifyMigration({ name: '073_a.sql', content: '-- title\r\n-- rollback-compat: additive\r\nSELECT 1;\r\n' });
    expect(r.error).toBeNull();
    expect(r.compat).toBe('additive');
  });

  it('rejects a 073+ file without a label', () => {
    const r = classifyMigration({ name: '073_a.sql', content: sql('-- just a comment') });
    expect(r.compat).toBeNull();
    expect(r.error).toMatch(/etiketi yok/);
  });

  it('rejects a label below the first 20 lines', () => {
    const filler = Array.from({ length: 20 }, (_, i) => `-- line ${i}`).join('\n');
    const r = classifyMigration({ name: '073_a.sql', content: `${filler}\n-- rollback-compat: additive\n` });
    expect(r.error).toMatch(/etiketi yok/);
  });

  it('rejects an unknown value or malformed spelling', () => {
    expect(classifyMigration({ name: '073_a.sql', content: sql('-- rollback-compat: safe') }).error).toMatch(/geçersiz/);
    expect(classifyMigration({ name: '073_a.sql', content: sql('--rollback-compat: additive') }).error).toMatch(/geçersiz/);
    expect(classifyMigration({ name: '073_a.sql', content: sql('-- Rollback-Compat: Additive') }).error).toMatch(/geçersiz/);
  });

  it('rejects two labels', () => {
    const r = classifyMigration({
      name: '073_a.sql',
      content: sql('-- rollback-compat: additive\n-- rollback-compat: breaking'),
    });
    expect(r.error).toMatch(/birden fazla/);
  });

  it('rejects a file name without a number prefix', () => {
    expect(classifyMigration({ name: 'add_table.sql', content: sql('-- rollback-compat: additive') }).error).toMatch(
      /numarayla/,
    );
  });
});

describe('checkRollbackCompat', () => {
  it('returns results sorted by file name', () => {
    const out = checkRollbackCompat([
      { name: '073_b.sql', content: sql('-- rollback-compat: additive') },
      { name: '001_init.sql', content: sql('') },
    ]);
    expect(out.map((r) => r.name)).toEqual(['001_init.sql', '073_b.sql']);
  });
});
