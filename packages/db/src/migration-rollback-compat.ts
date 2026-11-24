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

export function classifyMigration(file: MigrationFile): RollbackCompatResult {
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
