/**
 * ADR-047 K5.2 — `rollback-compat` migration header check.
 *
 * From migration 073 on, every migration file must carry exactly one line
 * `-- rollback-compat: additive` or `-- rollback-compat: breaking` within its
 * first 20 lines. Files numbered ≤ 072 are unlabelled and count as `breaking`
 * (fail-closed). Pure function: no filesystem access, so it is unit-testable.
 */

export const ROLLBACK_COMPAT_FIRST_LABELLED = 73;
export const ROLLBACK_COMPAT_HEADER_LINES = 20;

export type RollbackCompat = 'additive' | 'breaking';

export interface MigrationFile {
  name: string;
  content: string;
}

export interface RollbackCompatResult {
  name: string;
  /** `null` → the file is invalid; see `error`. */
  compat: RollbackCompat | null;
  /** `true` → number ≤ 072, unlabelled by design, counted as breaking. */
  legacy: boolean;
  error: string | null;
}

const NUMBER_PREFIX = /^(\d+)_/;
const ANY_LABEL_LINE = /^\s*--\s*rollback-compat\s*:/i;
const VALID_LABEL_LINE = /^-- rollback-compat: (additive|breaking)\s*$/;
// ADR-049 K3: node-pg-migrate's own section marker (same regex as its
// sqlMigration.js). Banned in 073+ even inside a comment: it silently turns the
// rest of the file into a "down" that `node-pg-migrate down` would execute.
const PG_MIGRATE_SECTION_MARKER = /^\s*--[\s-]*(up|down)\s+migration/im;

export function classifyMigration(file: MigrationFile): RollbackCompatResult {
  // node-pg-migrate also runs .js/.ts files from this folder; only .sql is
  // labelled, so any other file would bypass the check → reject it.
  if (!file.name.endsWith('.sql')) {
    return {
      name: file.name,
      compat: null,
      legacy: false,
      error: 'migration klasöründe yalnız .sql dosyası olabilir (başka tür dosya etiket kontrolünü atlar)',
    };
  }
  const match = NUMBER_PREFIX.exec(file.name);
  if (match === null) {
    return {
      name: file.name,
      compat: null,
      legacy: false,
      error: 'dosya adı numarayla başlamıyor (beklenen: 073_ad.sql)',
    };
  }
  const num = Number.parseInt(match[1] ?? '', 10);
  if (num < ROLLBACK_COMPAT_FIRST_LABELLED) {
    return { name: file.name, compat: 'breaking', legacy: true, error: null };
  }

  if (PG_MIGRATE_SECTION_MARKER.test(file.content)) {
    return {
      name: file.name,
      compat: null,
      legacy: false,
      error:
        'node-pg-migrate bölüm işareti ("-- Up/Down Migration") yasak — yorumda bile; down ayrı dosyada (ADR-049 K3)',
    };
  }

  const header = file.content.split(/\r?\n/).slice(0, ROLLBACK_COMPAT_HEADER_LINES);
  const labelLines = header.filter((line) => ANY_LABEL_LINE.test(line));
  if (labelLines.length === 0) {
    return {
      name: file.name,
      compat: null,
      legacy: false,
      error: `ilk ${ROLLBACK_COMPAT_HEADER_LINES} satırda "-- rollback-compat: additive|breaking" etiketi yok`,
    };
  }
  if (labelLines.length > 1) {
    return {
      name: file.name,
      compat: null,
      legacy: false,
      error: `birden fazla rollback-compat etiketi var (${labelLines.length}); tam olarak bir tane olmalı`,
    };
  }
  const valid = VALID_LABEL_LINE.exec(labelLines[0] ?? '');
  if (valid === null) {
    return {
      name: file.name,
      compat: null,
      legacy: false,
      error: `etiket biçimi geçersiz: "${(labelLines[0] ?? '').trim()}" (beklenen: "-- rollback-compat: additive" veya "-- rollback-compat: breaking")`,
    };
  }
  return { name: file.name, compat: valid[1] as RollbackCompat, legacy: false, error: null };
}

export function checkRollbackCompat(files: readonly MigrationFile[]): RollbackCompatResult[] {
  return [...files].sort((a, b) => a.name.localeCompare(b.name)).map(classifyMigration);
}

/**
 * ADR-049 K3/K5.1 — static pairing of `breaking` migrations with down files
 * in `packages/db/migrations-down/<name>.down.sql`.
 *
 * - 073+ `breaking`: exactly one of (down file) or (header `-- down: yok — <gerekçe>`).
 * - `additive` and legacy (≤072): no down file (K3: additive is forward-only; K7: no relabelling).
 * - Each down file: matching migration exists; header `-- down-for: <name>`; no own
 *   transaction control; no data-deleting statement (K2/K3).
 */
export interface DownCheckError {
  name: string;
  error: string;
}

const DOWN_SUFFIX = '.down.sql';
const DOWN_NONE_LINE = /^-- down: yok\s+[—-]\s+\S/;
const ANY_DOWN_NONE_LINE = /^\s*--\s*down\s*:/i;
// Checked per statement AFTER `executableSql` (comments, string literals and
// dollar-quoted bodies removed) — a plpgsql `$$ BEGIN … END $$` body is legit.
const TRANSACTION_STATEMENT = /^(BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT)\b/i;
const FORBIDDEN_IN_DOWN: ReadonlyArray<[RegExp, string]> = [
  [/\bCONCURRENTLY\b/i, 'CONCURRENTLY (transaction içinde koşamaz; down tek transaction — ADR-049 K4)'],
  [/\bDELETE\s+FROM\b/i, 'DELETE (down veri silemez — ADR-049 K2)'],
  [/\bTRUNCATE\b/i, 'TRUNCATE (down veri silemez — ADR-049 K2)'],
];

/**
 * Removes `--` and `/* *\/` comments, '…' / E'…' string literals and $tag$…$tag$
 * bodies with a single left-to-right scan, so a quote inside a comment or `--`
 * inside a string can neither hide nor fake a statement (db-migration-guard review).
 */
export function executableSql(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
      continue;
    }
    if (ch === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i += 1;
      }
      i += 1;
      out += "''";
      continue;
    }
    if (ch === '$') {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag !== null) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        i = end === -1 ? sql.length : end + tag[0].length;
        out += ' $$ ';
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function checkDownFiles(
  results: readonly RollbackCompatResult[],
  migrations: readonly MigrationFile[],
  downFiles: readonly MigrationFile[],
): DownCheckError[] {
  const errors: DownCheckError[] = [];
  const contentByName = new Map(migrations.map((m) => [m.name, m.content]));
  const downByBase = new Map<string, MigrationFile>();

  for (const down of downFiles) {
    if (!down.name.endsWith(DOWN_SUFFIX)) {
      errors.push({ name: down.name, error: `migrations-down/ içinde yalnız "<migration>${DOWN_SUFFIX}" dosyası olabilir` });
      continue;
    }
    downByBase.set(down.name.slice(0, -DOWN_SUFFIX.length), down);
  }

  for (const r of results) {
    if (r.error !== null) continue; // already reported by the label check
    const base = r.name.replace(/\.sql$/, '');
    const hasDown = downByBase.has(base);
    const header = (contentByName.get(r.name) ?? '').split(/\r?\n/).slice(0, ROLLBACK_COMPAT_HEADER_LINES);
    const noneLines = header.filter((line) => ANY_DOWN_NONE_LINE.test(line));

    if (r.legacy) {
      if (hasDown) errors.push({ name: r.name, error: '≤072 migration için down dosyası yazılmaz (ADR-049 K7)' });
      continue;
    }
    if (r.compat === 'additive') {
      if (hasDown) errors.push({ name: r.name, error: "additive migration'a down yazılmaz (ADR-049 K3)" });
      continue;
    }
    // breaking
    const validNone = noneLines.length === 1 && DOWN_NONE_LINE.test(noneLines[0] ?? '');
    if (noneLines.length > 0 && !validNone) {
      errors.push({
        name: r.name,
        error: `"-- down:" satırı geçersiz ya da birden fazla (beklenen tek satır: "-- down: yok — <gerekçe>")`,
      });
      continue;
    }
    if (hasDown && validNone) {
      errors.push({ name: r.name, error: 'hem down dosyası hem "-- down: yok" var — biri seçilmeli' });
    } else if (!hasDown && !validNone) {
      errors.push({
        name: r.name,
        error: `breaking migration: migrations-down/${base}${DOWN_SUFFIX} ya da başlıkta "-- down: yok — <gerekçe>" gerekli (ADR-049 K5)`,
      });
    }
  }

  for (const [base, down] of downByBase) {
    if (!contentByName.has(`${base}.sql`)) {
      errors.push({ name: down.name, error: `karşılığı olan migration yok (${base}.sql)` });
      continue;
    }
    const header = down.content.split(/\r?\n/).slice(0, ROLLBACK_COMPAT_HEADER_LINES);
    if (!header.some((line) => line.trim() === `-- down-for: ${base}`)) {
      errors.push({ name: down.name, error: `ilk ${ROLLBACK_COMPAT_HEADER_LINES} satırda "-- down-for: ${base}" başlığı yok` });
    }
    const body = executableSql(down.content);
    const statements = body.split(';').map((s) => s.trim());
    if (statements.some((s) => TRANSACTION_STATEMENT.test(s))) {
      errors.push({ name: down.name, error: 'yasak ifade: kendi transaction komutu (BEGIN/COMMIT/END/ROLLBACK/ABORT — betik açar)' });
    }
    for (const [pattern, why] of FORBIDDEN_IN_DOWN) {
      if (pattern.test(body)) errors.push({ name: down.name, error: `yasak ifade: ${why}` });
    }
  }

  return errors;
}
