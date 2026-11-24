/**
 * ADR-047 K5.2 — CI entry point: `pnpm --filter @restoran-pos/db check:rollback-compat`.
 * Reads `packages/db/migrations/*.sql`, exits 1 if any file ≥ 073 lacks a valid label.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRollbackCompat } from './migration-rollback-compat.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// Every file, not only *.sql: node-pg-migrate would also run .js/.ts files here.
const files = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => ({ name: entry.name, content: readFileSync(join(migrationsDir, entry.name), 'utf8') }));

const results = checkRollbackCompat(files);
const failures = results.filter((r) => r.error !== null);
const labelled = results.filter((r) => !r.legacy && r.error === null);

for (const r of labelled) {
  console.log(`✔ ${r.name}: ${r.compat}`);
}
for (const r of failures) {
  console.error(`✘ ${r.name}: ${r.error}`);
}
console.log(
  `rollback-compat: ${results.length} migration · ${results.filter((r) => r.legacy).length} eski (≤072, breaking sayılır) · ${labelled.length} etiketli · ${failures.length} hatalı`,
);

if (failures.length > 0) {
  console.error('Etiketi db-migration-guard belirler (ADR-047 K5.3).');
  process.exit(1);
}
