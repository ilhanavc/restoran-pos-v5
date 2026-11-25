/**
 * ADR-049 K4 — prod entry for one schema down, called ONLY by
 * `pos-release rollback <id> --sema-geri` as `sudo -u postgres env PGHOST=/var/run/postgresql
 * PGDATABASE=<db> tsx apply-down-cli.ts <migration-name> <down-file>`.
 * Connects with libpq env (peer auth over the local socket — no password anywhere) and runs
 * the SAME `applyDown` the CI round-trip test exercises (one transaction, lock/statement
 * timeouts, only the newest applied migration, pgmigrations row removed).
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import pg from 'pg';
import { applyDown } from './down-roundtrip.js';

const [name, file] = process.argv.slice(2);
if (name === undefined || file === undefined || !/^\d{3,}_[a-z0-9_]+$/.test(name)) {
  console.error('Kullanım: apply-down-cli <migration-adı> <down-dosyası>');
  process.exit(2);
}
// Defence in depth (CI already checks this): the file must be THIS migration's down.
if (basename(file) !== `${name}.down.sql`) {
  console.error(`✘ dosya adı ${name}.down.sql değil: ${file}`);
  process.exit(2);
}
const downSql = readFileSync(file, 'utf8');
if (!downSql.split(/\r?\n/).slice(0, 20).some((l) => l.trim() === `-- down-for: ${name}`)) {
  console.error(`✘ ilk 20 satırda "-- down-for: ${name}" yok: ${file}`);
  process.exit(2);
}

const client = new pg.Client();
await client.connect();
try {
  await applyDown(client, name, downSql);
  console.log(`✔ şema geri alındı: ${name}`);
} catch (err) {
  console.error(`✘ ${name}: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
