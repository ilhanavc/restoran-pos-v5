/**
 * ADR-049 K5.2 — CI entry point: `pnpm --filter @restoran-pos/db check:down-roundtrip [fixtureDir]`.
 * Uses DATABASE_URL as the admin connection (creates/drops throw-away `rt_*` databases).
 * With a fixture dir (`<dir>/migrations`, `<dir>/migrations-down`) the fixture is merged in —
 * used by CI for the positive and negative control.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDownRoundTrips } from './down-roundtrip.js';

const adminUrl = process.env['DATABASE_URL'];
if (adminUrl === undefined || adminUrl === '') {
  console.error('DATABASE_URL gerekli');
  process.exit(2);
}

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = process.argv[2];
const migrationsDirs = [join(packageDir, 'migrations')];
const downDirs = [join(packageDir, 'migrations-down')];
if (fixture !== undefined) {
  migrationsDirs.push(resolve(fixture, 'migrations'));
  downDirs.push(resolve(fixture, 'migrations-down'));
}

const results = await runDownRoundTrips(adminUrl, migrationsDirs, downDirs);
for (const r of results) {
  const line = `${r.name}: ${r.message} (${(r.ms / 1000).toFixed(1)} sn)`;
  if (r.ok) console.log(`✔ ${line}`);
  else console.error(`✘ ${line}`);
}
console.log(`down gidiş-dönüş: ${results.length} vaka · ${results.filter((r) => !r.ok).length} hatalı`);
if (results.some((r) => !r.ok)) process.exit(1);
