/**
 * ADR-047 K5.2 + ADR-049 K3/K5.1 — CI entry point: `pnpm --filter @restoran-pos/db check:rollback-compat`.
 * Reads `packages/db/migrations/` and `packages/db/migrations-down/`; exits 1 if any file ≥ 073
 * lacks a valid label, uses node-pg-migrate's section marker, or breaks the down-file pairing.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDownFiles, checkRollbackCompat } from './migration-rollback-compat.js';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');

// Every file, not only *.sql: node-pg-migrate would also run .js/.ts files here.
function readDir(dir: string): { name: string; content: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, content: readFileSync(join(dir, entry.name), 'utf8') }));
}

const files = readDir(join(packageDir, 'migrations'));
const downFiles = readDir(join(packageDir, 'migrations-down'));

const results = checkRollbackCompat(files);
const downErrors = checkDownFiles(results, files, downFiles);
const failures = [
  ...results.filter((r) => r.error !== null).map((r) => ({ name: r.name, error: r.error ?? '' })),
  ...downErrors,
];
const labelled = results.filter((r) => !r.legacy && r.error === null);

for (const r of labelled) {
  console.log(`✔ ${r.name}: ${r.compat}`);
}
for (const r of failures) {
  console.error(`✘ ${r.name}: ${r.error}`);
}
console.log(
  `rollback-compat: ${results.length} migration · ${results.filter((r) => r.legacy).length} eski (≤072, breaking sayılır) · ${labelled.length} etiketli · ${downFiles.length} down dosyası · ${failures.length} hatalı`,
);

if (failures.length > 0) {
  console.error('Etiketi ve down kararını db-migration-guard belirler (ADR-047 K5.3, ADR-049).');
  process.exit(1);
}
