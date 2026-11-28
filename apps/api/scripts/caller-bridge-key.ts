/**
 * ADR-052 K3 — Caller ID bridge key (`cb1_`) ops script.
 *
 * Modes (target tenant is always explicit):
 *   issue                 first key of a tenant (or the first after `revoke --now`)
 *   rotate                new key + old keys get `valid_until = now() + grace`
 *   revoke --after-grace  revoke keys whose grace has passed; REFUSED until the
 *                         newest key has a `last_used_at` (bridge switched)
 *   revoke --now          leak case: revoke every key of the tenant immediately
 *
 * Secret discipline (ADR-052 K3.2, stricter than ADR-044's "stdout once"): the
 * key is NEVER printed. It is written to a 0600 file (default
 * `/root/caller-bridge-key-<slug>.txt`), created exclusively — an existing file
 * is never overwritten. stdout carries only the file path and the key row id.
 * The file goes to the shop PC AS A FILE (RustDesk file transfer, never paste);
 * afterwards `shred -u` it on the server.
 *
 * All logic lives in `src/caller-bridge/keys.ts` (K3.5); this file only parses
 * arguments and delivers the secret. Delivery runs inside the DB transaction,
 * so a refused/failed write commits nothing.
 *
 * Usage (from apps/api):
 *   DATABASE_URL='postgresql://…' ./node_modules/.bin/tsx scripts/caller-bridge-key.ts \
 *     issue  --tenant-id <uuid> --actor <admin username|e-mail> [--out <path>]
 *   … rotate --tenant-id <uuid> --actor <admin> [--grace-days 7] [--out <path>]
 *   … revoke --tenant-id <uuid> --actor <admin> --after-grace
 *   … revoke --tenant-id <uuid> --actor <admin> --now
 */
import process from 'node:process';
import { unlink, writeFile } from 'node:fs/promises';
import type { Kysely } from 'kysely';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import {
  CallerBridgeKeyRefusedError,
  issueCallerBridgeKey,
  revokeCallerBridgeKeys,
  rotateCallerBridgeKey,
  type DeliverKey,
} from '../src/caller-bridge/keys.js';

const LOG_PREFIX = '[caller-bridge-key]';
/** Defense in depth: the slug becomes part of a path under /root. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export type CliMode = 'issue' | 'rotate' | 'revoke-after-grace' | 'revoke-now';

export interface CliArgs {
  mode: CliMode;
  tenantId: string;
  actor: string;
  graceDays?: number;
  outPath?: string;
}

function invalid(message: string): CallerBridgeKeyRefusedError {
  return new CallerBridgeKeyRefusedError('INVALID_ARGS', message);
}

function resolveMode(argv: readonly string[]): CliMode {
  const command = argv[0];
  const afterGrace = argv.includes('--after-grace');
  const now = argv.includes('--now');
  if (command === 'revoke') {
    if (afterGrace === now) {
      throw invalid('revoke tam olarak birini ister: --after-grace ya da --now.');
    }
    return afterGrace ? 'revoke-after-grace' : 'revoke-now';
  }
  if (afterGrace || now) {
    throw invalid('--after-grace / --now yalnız revoke ile kullanılır.');
  }
  if (command === 'issue' || command === 'rotate') return command;
  throw invalid('ilk argüman issue | rotate | revoke olmalı.');
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw invalid(`${flag} bir değer bekliyor.`);
    }
    return value;
  };
  const mode = resolveMode(argv);
  const tenantId = get('--tenant-id');
  const actor = get('--actor');
  if (tenantId === undefined || actor === undefined) {
    throw invalid('--tenant-id ve --actor zorunlu.');
  }
  const graceRaw = get('--grace-days');
  const outPath = get('--out');
  if (graceRaw !== undefined && mode !== 'rotate') {
    throw invalid('--grace-days yalnız rotate ile kullanılır.');
  }
  if (outPath !== undefined && mode !== 'issue' && mode !== 'rotate') {
    throw invalid('--out yalnız issue / rotate ile kullanılır.');
  }
  // `exactOptionalPropertyTypes`: optional fields are present or absent.
  return {
    mode,
    tenantId,
    actor,
    ...(graceRaw === undefined ? {} : { graceDays: Number(graceRaw) }),
    ...(outPath === undefined ? {} : { outPath }),
  };
}

export function defaultKeyPath(slug: string): string {
  if (!SLUG_RE.test(slug)) {
    throw invalid('tenant slug dosya adına uygun değil; --out ile yol verin.');
  }
  return `/root/caller-bridge-key-${slug}.txt`;
}

/**
 * Exclusive create (`wx`) with mode 0600 — the umask can only remove bits, so
 * the file is never wider than owner read/write. Existing file → refused.
 */
export async function writeKeyFile(path: string, key: string): Promise<void> {
  try {
    await writeFile(path, `${key}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'EEXIST') {
      throw invalid(`${path} zaten var; üzerine yazılmaz. Eski dosyayı shred -u ile silin ya da --out verin.`);
    }
    throw err;
  }
}

/**
 * Runs one mode and returns the stdout lines. Lines never contain the key:
 * only the file path, the key row id and counts.
 */
export async function runCallerBridgeKeyCli(db: Kysely<DB>, args: CliArgs): Promise<string[]> {
  const target = { tenantId: args.tenantId, actor: args.actor };

  if (args.mode === 'revoke-after-grace' || args.mode === 'revoke-now') {
    const r = await revokeCallerBridgeKeys(db, {
      ...target,
      mode: args.mode === 'revoke-now' ? 'now' : 'after_grace',
    });
    return [
      args.mode === 'revoke-now'
        ? `${LOG_PREFIX} ${r.tenantSlug}: ${String(r.revokedCount)} anahtar HEMEN iptal edildi. Yeni anahtar için: issue.`
        : `${LOG_PREFIX} ${r.tenantSlug}: grace'i dolmuş ${String(r.revokedCount)} anahtar iptal edildi (kullanımda olan anahtar id=${r.provenKeyId ?? '-'}).`,
    ];
  }

  // Object holder: TS does not track assignments made inside the callback.
  const written: { path: string | null } = { path: null };
  const deliver: DeliverKey = async ({ plaintextKey, tenantSlug }) => {
    const path = args.outPath ?? defaultKeyPath(tenantSlug);
    await writeKeyFile(path, plaintextKey);
    written.path = path;
  };

  try {
    const r =
      args.mode === 'issue'
        ? await issueCallerBridgeKey(db, { ...target, deliver })
        : await rotateCallerBridgeKey(db, {
            ...target,
            deliver,
            ...(args.graceDays === undefined ? {} : { graceDays: args.graceDays }),
          });
    return [`${LOG_PREFIX} anahtar dosyası: ${written.path ?? '-'}`, `${LOG_PREFIX} anahtar id=${r.keyId}`];
  } catch (err) {
    // The file was written but the transaction did not commit: the key in it
    // is unusable — remove it so no stray secret stays on disk.
    const path = written.path;
    if (path !== null) await unlink(path).catch(() => undefined);
    throw err;
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  // `app_tenant` preferred (NOBYPASSRLS → `withTenant` really bites); same
  // rationale as `rotate-agent-key.ts`.
  const connectionString = process.env.DATABASE_URL ?? process.env.MIGRATOR_DATABASE_URL;
  if (connectionString === undefined) {
    console.error(`${LOG_PREFIX} eksik env: DATABASE_URL (tercih edilen) veya MIGRATOR_DATABASE_URL`);
    process.exit(1);
  }
  // umask 077 for anything this process creates (belt and braces with 0600).
  if (process.platform !== 'win32') process.umask(0o077);

  const db = createKysely(createPool({ connectionString }));
  try {
    for (const line of await runCallerBridgeKeyCli(db, args)) console.log(line);
  } finally {
    // `db.destroy()` also ends the pool; a second `pool.end()` would throw
    // (rotate-agent-key.ts, Dalga C lesson).
    await db.destroy();
  }
}

if (process.argv[1]?.endsWith('caller-bridge-key.ts') === true) {
  main().catch((err: unknown) => {
    console.error(`${LOG_PREFIX} HATA: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
