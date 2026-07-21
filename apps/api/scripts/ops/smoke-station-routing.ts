/**
 * ADR-032 Amendment 1 K15 — ÜÇ İSTASYON YÖNLENDİRME SMOKE'u.
 *
 * NEDEN BU, `render-station-test-receipt.ts` DEĞİL: o script doğrudan TCP
 * 9100'e basar → yazıcının RENDER yeteneğini kanıtlar ama YÖNLENDİRMEYİ
 * kanıtlamaz. Cutover'ın asıl riski yönlendirmede: `grill` işini FIRIN
 * agent'ı kapar mı? `kitchen` işi IZGARA'dan çıkar mı? Bu script işleri
 * KUYRUĞA yazar ve zincirin tamamını sınar:
 *
 *     print_jobs → claim (agent `?kind=` filtresi) → transport → kağıt
 *
 * Her fiş "TEST" damgalıdır ve "HAZIRLAMAYIN" notu taşır — mutfak personeli
 * gerçek sipariş sanıp ürün hazırlamasın (K15 gerekliliği).
 *
 * Kullanım (apps/api içinden, prod DATABASE_URL ile):
 *   DATABASE_URL=... pnpm exec tsx scripts/ops/smoke-station-routing.ts --tenant <uuid>
 *
 * Kabul kriteri: üç iş de `success` VE kağıtta her fiş DOĞRU yazıcıdan çıkmış
 * olmalı. `success` tek başına yetmez — çapraz-kontaminasyon ancak gözle
 * doğrulanır (yanlış yazıcıdan çıkan iş de `success` raporlar).
 */
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from '@restoran-pos/db';
import { renderKitchenReceipt } from '../../src/print/templates/kitchen-receipt.js';

const STATIONS = [
  { kind: 'kitchen', label: 'FIRIN' },
  { kind: 'grill', label: 'IZGARA' },
  { kind: 'bill', label: 'KASA' },
] as const;

function readArg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = process.argv[i + 1];
  if (i === -1 || v === undefined) throw new Error(`Eksik parametre: --${name}`);
  return v;
}

const tenantId = readArg('tenant');
const dbUrl = process.env['DATABASE_URL'];
if (dbUrl === undefined || dbUrl === '') {
  throw new Error('DATABASE_URL tanımlı değil.');
}

const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: dbUrl }) }),
});

const jobIds = new Map<string, string>();

for (const { kind, label } of STATIONS) {
  const bytes = renderKitchenReceipt({
    order_type: 'dine_in',
    tenant_header: 'TEST',
    order_no: 0,
    table_label: `TEST ${label}`,
    area_label: null,
    server_name: 'SISTEM TESTI',
    created_at_local: new Date().toLocaleString('tr-TR'),
    customer_name: null,
    customer_phone: null,
    delivery_address: null,
    delivery_note: null,
    planned_payment_type: null,
    total_cents: 0,
    station_label: label,
    part_label: null,
    items: [
      {
        name: `TEST - ${label} YAZICISI`,
        qty: 1,
        variantName: null,
        lineTotalCents: 0,
        modifiers: ['HAZIRLAMAYIN'],
        note: 'sistem testi - bu fis siparis degildir, cope atin',
      },
    ],
  });

  const id = randomUUID();
  jobIds.set(kind, id);
  await db
    .insertInto('print_jobs')
    .values({
      id,
      tenant_id: tenantId,
      status: 'queued',
      payload: {
        kind,
        bytesBase64: Buffer.from(bytes).toString('base64'),
        meta: { smoke: true, station: label, renderedAt: new Date().toISOString() },
      },
    })
    .execute();
  console.log(`kuyruga yazildi  ${kind.padEnd(8)} -> ${label.padEnd(7)} job=${id.slice(0, 8)}`);
}

console.log('\nAgent yoklamasi izleniyor (en fazla 60 sn)...');
const allIds = [...jobIds.values()];
for (let tick = 0; tick < 20; tick++) {
  await new Promise((r) => setTimeout(r, 3000));
  const rows = await db
    .selectFrom('print_jobs')
    .select(['id', 'status'])
    .where('id', 'in', allIds)
    .execute();
  const byKind = [...jobIds.entries()]
    .map(([kind, id]) => `${kind}=${rows.find((r) => r.id === id)?.status ?? '?'}`)
    .join('  ');
  console.log(`  ${byKind}`);
  if (rows.every((r) => r.status === 'success' || r.status === 'failed')) break;
}

console.log('\n=== SONUC ===');
const final = await db
  .selectFrom('print_jobs')
  .select(['id', 'status', 'attempts'])
  .where('id', 'in', allIds)
  .execute();
let allOk = true;
for (const { kind, label } of STATIONS) {
  const row = final.find((r) => r.id === jobIds.get(kind));
  const status = row?.status ?? 'BULUNAMADI';
  if (status !== 'success') allOk = false;
  console.log(`  ${kind.padEnd(8)} (${label.padEnd(7)}) -> ${status}  attempts=${row?.attempts ?? '-'}`);
}
console.log(
  allOk
    ? '\nUC IS DE BASILDI. Simdi KAGIDA bakin: her fis kendi yazicisindan mi cikti?'
    : '\nEN AZ BIR IS BASILAMADI - yukaridaki durumlari inceleyin.',
);
await db.destroy();
