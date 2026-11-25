/**
 * ADR-049 K5.2 — dynamic round-trip test for every down file.
 *
 * For each `migrations-down/<name>.down.sql`, on a throw-away database:
 *   up to the migration BEFORE <name>  → catalog snapshot A
 *   up <name>                          → snapshot must differ from A (else the case proves nothing)
 *   down (same path pos-release will use: one transaction, run the down SQL,
 *         delete the pgmigrations row) → snapshot B, require A == B
 *   up <name> again                    → must succeed
 *
 * Snapshot = sorted text lines from pg_catalog (tables, columns BY NAME, constraints,
 * indexes, policies, functions, triggers, enums, grants). Columns are compared by name,
 * not position: a down that re-adds a dropped column puts it last, which is fine.
 * pg_dump is not used: the CI runner's client version may not match the server.
 *
 * Seed data is NOT loaded here (deviation from ADR-049 K5.2, recorded in the ADR):
 * `seed.ts` targets the head schema only. Data behaviour of a down is exercised in
 * the PR-5 drill on a local copy of a prod backup.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const require = createRequire(import.meta.url);

export interface RoundTripResult {
  name: string;
  ok: boolean;
  ms: number;
  message: string;
}

const SNAPSHOT_QUERIES: ReadonlyArray<[string, string]> = [
  [
    'table',
    `SELECT n.nspname||'.'||c.relname||' kind='||c.relkind||' rls='||c.relrowsecurity||' force='||c.relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND c.relkind IN ('r','p','v','m','S')`,
  ],
  [
    'column',
    `SELECT n.nspname||'.'||c.relname||'.'||a.attname||' '||format_type(a.atttypid,a.atttypmod)
            ||' notnull='||a.attnotnull||' default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'')
       FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND c.relkind IN ('r','p','v','m')
        AND a.attnum>0 AND NOT a.attisdropped`,
  ],
  [
    'constraint',
    `SELECT conrelid::regclass::text||' '||conname||' '||pg_get_constraintdef(oid)
       FROM pg_constraint WHERE connamespace NOT IN ('pg_catalog'::regnamespace,'information_schema'::regnamespace)`,
  ],
  ['index', `SELECT schemaname||' '||indexdef FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema')`],
  [
    'policy',
    `SELECT schemaname||'.'||tablename||' '||policyname||' '||permissive||' '||cmd||' '||array_to_string(roles,',')
            ||' using='||coalesce(qual,'')||' check='||coalesce(with_check,'')
       FROM pg_policies`,
  ],
  [
    'function',
    `SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||md5(pg_get_functiondef(p.oid))
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND p.prokind IN ('f','p')`,
  ],
  ['trigger', `SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal`],
  [
    'enum',
    `SELECT t.typname||' '||string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
       FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid GROUP BY t.typname`,
  ],
  [
    'grant',
    `SELECT table_schema||'.'||table_name||' '||grantee||' '||privilege_type FROM information_schema.role_table_grants
      WHERE table_schema NOT IN ('pg_catalog','information_schema')`,
  ],
];

export async function catalogSnapshot(client: pg.Client): Promise<string[]> {
  const lines: string[] = [];
  for (const [kind, sql] of SNAPSHOT_QUERIES) {
    const res = await client.query<Record<string, string>>(sql);
    for (const row of res.rows) lines.push(`${kind} ${Object.values(row)[0] ?? ''}`);
  }
  return lines.sort();
}

/** Same path `pos-release rollback --sema-geri` will take (ADR-049 K4): one transaction. */
export async function applyDown(client: pg.Client, migrationName: string, downSql: string): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(downSql);
    const del = await client.query('DELETE FROM pgmigrations WHERE name = $1', [migrationName]);
    if (del.rowCount !== 1) throw new Error(`pgmigrations kaydı bulunamadı: ${migrationName}`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

function migrate(dbUrl: string, dir: string, count: number): void {
  if (count <= 0) return;
  const bin = require.resolve('node-pg-migrate/bin/node-pg-migrate.js');
  const res = spawnSync(process.execPath, [bin, '-m', dir, 'up', String(count)], {
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`node-pg-migrate up ${count} başarısız:\n${res.stderr || res.stdout}`);
  }
}

function withDatabase(adminUrl: string, dbName: string): string {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

function diff(a: string[], b: string[]): string {
  const setA = new Set(a);
  const setB = new Set(b);
  const missing = a.filter((l) => !setB.has(l)).map((l) => `  - ${l}`);
  const extra = b.filter((l) => !setA.has(l)).map((l) => `  + ${l}`);
  return [...missing, ...extra].slice(0, 40).join('\n');
}

/**
 * @param migrationsDirs  directories merged (in order) into one temp migrations folder
 * @param downDirs        directories holding `<name>.down.sql`
 */
export async function runDownRoundTrips(
  adminUrl: string,
  migrationsDirs: string[],
  downDirs: string[],
): Promise<RoundTripResult[]> {
  const work = mkdtempSync(join(tmpdir(), 'down-rt-'));
  const migDir = join(work, 'migrations');
  for (const d of migrationsDirs) cpSync(d, migDir, { recursive: true });
  const names = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.replace(/\.sql$/, ''))
    .sort();

  const downs = downDirs
    .filter((d) => existsSync(d))
    .flatMap((d) =>
      readdirSync(d)
        .filter((f) => f.endsWith('.down.sql'))
        .map((f) => ({ name: f.replace(/\.down\.sql$/, ''), sql: readFileSync(join(d, f), 'utf8') })),
    )
    .sort((x, y) => x.name.localeCompare(y.name));

  const results: RoundTripResult[] = [];
  if (downs.length === 0) {
    // ADR-049 K5: no down file → 0 cases, green by design (no DB connection needed).
    rmSync(work, { recursive: true, force: true });
    return results;
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    for (const [i, down] of downs.entries()) {
      const started = Date.now();
      const dbName = `rt_${process.pid}_${i}`;
      const idx = names.indexOf(down.name);
      if (idx < 0) {
        results.push({ name: down.name, ok: false, ms: 0, message: 'karşılığı olan migration yok' });
        continue;
      }
      await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await admin.query(`CREATE DATABASE ${dbName}`);
      const dbUrl = withDatabase(adminUrl, dbName);
      const client = new pg.Client({ connectionString: dbUrl });
      try {
        migrate(dbUrl, migDir, idx);
        await client.connect();
        const a = await catalogSnapshot(client);
        migrate(dbUrl, migDir, 1);
        const afterUp = await catalogSnapshot(client);
        if (diff(a, afterUp) === '') {
          throw new Error('migration şemayı değiştirmedi — bu vaka hiçbir şey kanıtlamaz');
        }
        await applyDown(client, down.name, down.sql);
        const b = await catalogSnapshot(client);
        const d = diff(a, b);
        if (d !== '') throw new Error(`down sonrası şema migration öncesinden farklı:\n${d}`);
        migrate(dbUrl, migDir, 1);
        results.push({ name: down.name, ok: true, ms: Date.now() - started, message: 'ileri → geri → ileri tamam' });
      } catch (err) {
        results.push({
          name: down.name,
          ok: false,
          ms: Date.now() - started,
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        await client.end().catch(() => undefined);
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
      }
    }
  } finally {
    await admin.end();
    rmSync(work, { recursive: true, force: true });
  }
  return results;
}
