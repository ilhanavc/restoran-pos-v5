import { describe, expect, it } from 'vitest';
import { checkDownFiles, checkRollbackCompat, classifyMigration } from './migration-rollback-compat.js';

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

  it('rejects non-.sql files, which node-pg-migrate would run unchecked', () => {
    expect(classifyMigration({ name: '073_a.js', content: '// rollback-compat: additive' }).error).toMatch(/yalnız \.sql/);
    expect(classifyMigration({ name: '050_old.ts', content: '' }).error).toMatch(/yalnız \.sql/);
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

describe('node-pg-migrate section marker (ADR-049 K3)', () => {
  it('rejects "-- Down Migration" / "-- Up Migration" in 073+, even as a comment', () => {
    const down = classifyMigration({ name: '073_a.sql', content: sql('-- rollback-compat: additive\n-- DOWN migration YOK') });
    expect(down.error).toMatch(/bölüm işareti/);
    const up = classifyMigration({ name: '073_a.sql', content: sql('-- rollback-compat: additive\n-- Up Migration') });
    expect(up.error).toMatch(/bölüm işareti/);
  });

  it('leaves ≤072 files alone (applied migrations are never edited)', () => {
    const r = classifyMigration({ name: '055_rls_orders.sql', content: '-- DOWN migration YOK\nSELECT 1;' });
    expect(r.error).toBeNull();
    expect(r.legacy).toBe(true);
  });

  it('does not confuse "-- down: yok — …" with the marker', () => {
    const r = classifyMigration({
      name: '073_a.sql',
      content: sql('-- rollback-compat: breaking\n-- down: yok — daralt adımı, veri parça geri yüklemeyle'),
    });
    expect(r.error).toBeNull();
  });
});

describe('checkDownFiles (ADR-049 K3/K5.1)', () => {
  const mig = (name: string, header: string) => ({ name, content: sql(header) });
  const down = (name: string, body: string) => ({ name, content: body });
  const run = (migrations: { name: string; content: string }[], downs: { name: string; content: string }[]) =>
    checkDownFiles(checkRollbackCompat(migrations), migrations, downs);

  it('accepts breaking + valid down file', () => {
    const m = [mig('073_drop_x.sql', '-- rollback-compat: breaking')];
    const d = [down('073_drop_x.down.sql', '-- down-for: 073_drop_x\nALTER TABLE a ADD COLUMN x int;\n')];
    expect(run(m, d)).toEqual([]);
  });

  it('accepts breaking + justified "-- down: yok"', () => {
    const m = [mig('073_drop_x.sql', '-- rollback-compat: breaking\n-- down: yok — daralt, K1 penceresi doldu')];
    expect(run(m, [])).toEqual([]);
  });

  it('rejects breaking with neither', () => {
    const errs = run([mig('073_drop_x.sql', '-- rollback-compat: breaking')], []);
    expect(errs.map((e) => e.error).join()).toMatch(/migrations-down\/073_drop_x\.down\.sql/);
  });

  it('rejects "-- down: yok" without a reason, and having both', () => {
    expect(run([mig('073_a.sql', '-- rollback-compat: breaking\n-- down: yok')], [])[0]?.error).toMatch(/geçersiz/);
    const both = run(
      [mig('073_a.sql', '-- rollback-compat: breaking\n-- down: yok — x')],
      [down('073_a.down.sql', '-- down-for: 073_a\nSELECT 1;')],
    );
    expect(both[0]?.error).toMatch(/hem down dosyası/);
  });

  it('rejects a down file for additive or legacy migrations', () => {
    const add = run([mig('073_a.sql', '-- rollback-compat: additive')], [down('073_a.down.sql', '-- down-for: 073_a\n')]);
    expect(add[0]?.error).toMatch(/additive/);
    const legacy = run([mig('072_a.sql', '-- x')], [down('072_a.down.sql', '-- down-for: 072_a\n')]);
    expect(legacy[0]?.error).toMatch(/≤072/);
  });

  it('rejects orphan, misnamed or mis-headed down files', () => {
    const m = [mig('073_a.sql', '-- rollback-compat: breaking\n-- down: yok — x')];
    expect(run(m, [down('074_b.down.sql', '-- down-for: 074_b\n')])[0]?.error).toMatch(/karşılığı olan migration yok/);
    expect(run(m, [down('notes.txt', '')])[0]?.error).toMatch(/\.down\.sql/);
    const wrongHeader = run(
      [mig('073_a.sql', '-- rollback-compat: breaking')],
      [down('073_a.down.sql', '-- down-for: 073_other\nSELECT 1;')],
    );
    expect(wrongHeader.map((e) => e.error).join()).toMatch(/down-for: 073_a/);
  });

  it('rejects transaction control and data-deleting statements, but not in comments', () => {
    const m = [mig('073_a.sql', '-- rollback-compat: breaking')];
    const bad = run(m, [down('073_a.down.sql', '-- down-for: 073_a\nBEGIN;\nDELETE FROM orders;\nTRUNCATE x;\nCOMMIT;')]);
    const msgs = bad.map((e) => e.error).join(' | ');
    expect(msgs).toMatch(/transaction/);
    expect(msgs).toMatch(/DELETE/);
    expect(msgs).toMatch(/TRUNCATE/);
    const commentOnly = run(m, [down('073_a.down.sql', '-- down-for: 073_a\n-- not a DELETE FROM, no BEGIN here\nDROP INDEX IF EXISTS i;')]);
    expect(commentOnly).toEqual([]);
  });
});

describe('down-file statement scan (db-migration-guard review)', () => {
  const m = [{ name: '073_a.sql', content: sql('-- rollback-compat: breaking') }];
  const run = (body: string) =>
    checkDownFiles(checkRollbackCompat(m), m, [{ name: '073_a.down.sql', content: `-- down-for: 073_a\n${body}` }]);

  it('allows a plpgsql body with BEGIN … END (restoring a function)', () => {
    const fn = [
      'CREATE OR REPLACE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $fn$',
      'BEGIN',
      "  IF NEW.x IS NULL THEN RAISE EXCEPTION 'x -- y'; END IF;",
      '  DELETE FROM audit_tmp; -- inside the body, not executed by the down',
      '  RETURN NEW;',
      'END',
      '$fn$;',
    ].join('\n');
    expect(run(fn)).toEqual([]);
  });

  it('rejects END; and ABORT; as transaction control', () => {
    expect(run('DROP INDEX i;\nEND;')[0]?.error).toMatch(/transaction/);
    expect(run('ABORT;')[0]?.error).toMatch(/transaction/);
  });

  it("does not let '--' inside a string or a quote inside a comment hide a DELETE", () => {
    expect(run("SET a = '--'; DELETE FROM orders;").map((e) => e.error).join()).toMatch(/DELETE/);
    expect(run("-- don't\nDELETE FROM orders;").map((e) => e.error).join()).toMatch(/DELETE/);
    expect(run('/* DELETE FROM orders */ DROP INDEX i;')).toEqual([]);
  });
});
