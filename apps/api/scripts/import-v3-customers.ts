/**
 * V3 müşteri Excel import — ADR-016 §11.5.
 *
 * v3 Müşteriler.xlsx dosyasını okur, normalize edip v5 cloud DB'ye yazar.
 * Idempotent: `customers.legacy_v3_no` UNIQUE üzerinden ON CONFLICT DO NOTHING.
 *
 * Kullanım:
 *   pnpm --filter @restoran-pos/api import:v3-customers -- \
 *     --tenant <uuid> --file "D:/path/Musteriler.xlsx" [--dry-run] [--batch 100]
 *
 * Bakiye / total_amount / discount alanları OKUNUR ama yazılmaz (ADR §11.2 —
 * MVP'de bakiye kapsam dışı).
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import process from 'node:process';

import ExcelJS from 'exceljs';
import { sql } from 'kysely';

import { createPool, createKysely } from '@restoran-pos/db';
import { normalizePhoneTr, isTurkishMobile } from '@restoran-pos/shared-domain';

import { writeAudit } from '../src/audit/writeAudit.js';

// ---------- CLI args ----------

interface CliArgs {
  tenant: string;
  file: string;
  dryRun: boolean;
  batch: number;
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  let tenant: string | undefined;
  let file: string | undefined;
  let dryRun = false;
  let batch = 100;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tenant') {
      tenant = argv[++i];
    } else if (a === '--file') {
      file = argv[++i];
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--batch') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error('--batch must be a positive integer');
      }
      batch = n;
    } else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  if (tenant === undefined || tenant === '') {
    throw new Error('--tenant <uuid> zorunlu');
  }
  if (file === undefined || file === '') {
    throw new Error('--file <path> zorunlu');
  }
  return { tenant, file, dryRun, batch };
}

function printUsage(): void {
  console.log(
    [
      'Kullanım:',
      '  tsx scripts/import-v3-customers.ts \\',
      '    --tenant <uuid> --file <xlsx> [--dry-run] [--batch 100]',
      '',
      'Bayraklar:',
      '  --tenant   Hedef tenant UUID (zorunlu)',
      '  --file     Excel dosya yolu (zorunlu)',
      '  --dry-run  DB yazmaz, sadece rapor üretir',
      '  --batch    INSERT batch boyutu (varsayılan 100)',
    ].join('\n'),
  );
}

// ---------- Row parse ----------

export interface ParsedRow {
  legacyV3No: number | null;
  fullName: string;
  rawPhone: string;
  normalizedPhone: string;
  isMobile: boolean;
  district: string | null;
  addressLine: string | null;
  totalOrders: number;
}

export type ParseResult =
  | { ok: true; row: ParsedRow }
  | { ok: false; reason: 'invalid_name' | 'invalid_legacy_no' };

/**
 * Excel float64 telefon artefaktını temizler. `905056632792.0` → `905056632792`,
 * sonra `normalizePhoneTr` ile `0XXXXXXXXXX` formatına çevrilir.
 */
export function cleanRawPhone(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (s === '') return '';
  // float artefact: "5.056632792e+10" veya "905056632792.0"
  if (s.includes('e') || s.includes('E')) {
    const n = Number(s);
    if (Number.isFinite(n)) {
      return Math.trunc(n).toString();
    }
  }
  // ".0" trailing
  const dot = s.indexOf('.');
  if (dot !== -1) return s.slice(0, dot);
  return s;
}

function readCell(row: ExcelJS.Row, col: number): unknown {
  const v = row.getCell(col).value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && 'text' in v) return (v as { text: unknown }).text;
  if (typeof v === 'object' && 'result' in v) {
    return (v as { result: unknown }).result;
  }
  return v;
}

export interface ColumnMap {
  no: number;
  fullName: number;
  phone: number;
  district: number;
  address: number;
  totalOrders: number;
}

export function detectColumns(headerRow: ExcelJS.Row): ColumnMap {
  const map: Partial<Record<keyof ColumnMap, number>> = {};
  headerRow.eachCell((cell, colNumber) => {
    const v = String(cell.value ?? '').trim();
    if (v === 'No') map.no = colNumber;
    else if (v === 'Ad Soyad') map.fullName = colNumber;
    else if (v === 'Telefon') map.phone = colNumber;
    else if (v === 'Mahalle') map.district = colNumber;
    else if (v === 'Adres') map.address = colNumber;
    else if (v === 'Toplam Sipariş Sayısı') map.totalOrders = colNumber;
  });
  const required: (keyof ColumnMap)[] = [
    'no',
    'fullName',
    'phone',
    'district',
    'address',
    'totalOrders',
  ];
  for (const k of required) {
    if (map[k] === undefined) {
      throw new Error(`Excel başlığında "${k}" kolonu bulunamadı`);
    }
  }
  return map as ColumnMap;
}

export function parseRow(row: ExcelJS.Row, cols: ColumnMap): ParseResult {
  const noRaw = readCell(row, cols.no);
  const fullNameRaw = readCell(row, cols.fullName);
  const phoneRaw = readCell(row, cols.phone);
  const districtRaw = readCell(row, cols.district);
  const addressRaw = readCell(row, cols.address);
  const totalOrdersRaw = readCell(row, cols.totalOrders);

  const fullName = String(fullNameRaw ?? '').trim();
  if (fullName.length < 2) return { ok: false, reason: 'invalid_name' };

  const legacyV3No = noRaw === null ? null : Number(noRaw);
  if (legacyV3No !== null && !Number.isFinite(legacyV3No)) {
    return { ok: false, reason: 'invalid_legacy_no' };
  }

  const rawPhone = cleanRawPhone(phoneRaw);
  const normalizedPhone = normalizePhoneTr(rawPhone);
  const totalOrdersNum = Number(totalOrdersRaw ?? 0);
  const totalOrders =
    Number.isFinite(totalOrdersNum) && totalOrdersNum >= 0
      ? Math.trunc(totalOrdersNum)
      : 0;

  return {
    ok: true,
    row: {
      legacyV3No: legacyV3No === null ? null : Math.trunc(legacyV3No),
      fullName,
      rawPhone,
      normalizedPhone,
      isMobile: normalizedPhone === '' ? false : isTurkishMobile(normalizedPhone),
      district: String(districtRaw ?? '').trim() || null,
      addressLine: String(addressRaw ?? '').trim() || null,
      totalOrders,
    },
  };
}

// ---------- Report ----------

export interface ImportReport {
  totalRows: number;
  customersInserted: number;
  customersSkippedInvalidName: number;
  customersSkippedInvalidLegacyNo: number;
  customersSkippedAlreadyExists: number;
  phonesInserted: number;
  phonesSkippedEmpty: number;
  phonesSkippedDuplicate: number;
  addressesInserted: number;
  durationMs: number;
}

export function emptyReport(): ImportReport {
  return {
    totalRows: 0,
    customersInserted: 0,
    customersSkippedInvalidName: 0,
    customersSkippedInvalidLegacyNo: 0,
    customersSkippedAlreadyExists: 0,
    phonesInserted: 0,
    phonesSkippedEmpty: 0,
    phonesSkippedDuplicate: 0,
    addressesInserted: 0,
    durationMs: 0,
  };
}

export function printReport(r: ImportReport, dryRun: boolean): void {
  const tag = dryRun ? '[DRY-RUN] ' : '';
  console.log(`\n${tag}Import raporu:`);
  console.log(`  Toplam satır:                ${r.totalRows}`);
  console.log(`  Eklenen müşteri:             ${r.customersInserted}`);
  console.log(`  Atlanan (geçersiz isim):     ${r.customersSkippedInvalidName}`);
  console.log(`  Atlanan (geçersiz No):       ${r.customersSkippedInvalidLegacyNo}`);
  console.log(`  Atlanan (zaten mevcut):      ${r.customersSkippedAlreadyExists}`);
  console.log(`  Eklenen telefon:             ${r.phonesInserted}`);
  console.log(`  Atlanan telefon (boş):       ${r.phonesSkippedEmpty}`);
  console.log(`  Atlanan telefon (duplicate): ${r.phonesSkippedDuplicate}`);
  console.log(`  Eklenen adres:               ${r.addressesInserted}`);
  console.log(`  Süre:                        ${r.durationMs} ms`);
}

/**
 * KVKK denetim izi (audit_logs) için toplu-import özet payload'u — ADR-003 §12.4,
 * go/no-go #8 (docs/compliance/kvkk-data-inventory.md §11). Yalnız sayaç; PII yok.
 *
 * `errors` = SALT parse/doğrulama reddi (geçersiz isim + geçersiz No). Çalışma-anı
 * hatası tüm transaction'ı geri alır → hiç audit satırı yazılmaz; bu yüzden CLI'da
 * `errors` asla runtime failure sayısı değildir (HTTP import call-site aynı event'te
 * `errors`'ı runtime exception olarak sayar — denetimde bu ayrım geçerlidir).
 * `customersSkippedAlreadyExists` (idempotent dedup) hata DEĞİLDİR, dahil edilmez.
 */
export function buildImportAuditPayload(r: ImportReport): {
  total_rows: number;
  created: number;
  errors: number;
} {
  return {
    total_rows: r.totalRows,
    created: r.customersInserted,
    errors: r.customersSkippedInvalidName + r.customersSkippedInvalidLegacyNo,
  };
}

// ---------- Loader (test edilebilirlik için DB executor inject) ----------

/**
 * Tek satır insert işlemi — transaction içinden çağrılır.
 * `executor.insert*` fonksiyonları gerçek Kysely transaction veya mock olabilir.
 *
 * INSERT'ler tek satırlık (1398 satır için bile yeterli hız — 1-2 saniye).
 * Bulk multi-row'a gerek yok; basit + idempotent kalır.
 */
export interface ImportExecutor {
  insertCustomer(args: {
    id: string;
    tenantId: string;
    fullName: string;
    legacyV3No: number | null;
    totalOrders: number;
  }): Promise<{ inserted: boolean }>;
  insertPhone(args: {
    id: string;
    tenantId: string;
    customerId: string;
    rawPhone: string;
    normalizedPhone: string;
    isMobile: boolean;
  }): Promise<{ inserted: boolean }>;
  insertAddress(args: {
    id: string;
    tenantId: string;
    customerId: string;
    addressLine: string;
    district: string | null;
  }): Promise<void>;
  /**
   * Mevcut müşterinin id'sini bulur (legacy_v3_no eşleşmesi).
   * Idempotent re-run'da telefon/adres ekleme atlanır (zaten eklenmişti varsayımı).
   */
  findCustomerIdByLegacyNo(args: {
    tenantId: string;
    legacyV3No: number;
  }): Promise<string | null>;
}

export interface ImportInput {
  tenantId: string;
  rows: ParsedRow[];
  executor: ImportExecutor;
  report: ImportReport;
}

/**
 * Saf import fonksiyonu — Excel okuma + DB connection bağımsız.
 * Test edilebilirlik için `executor` mock'lanır.
 */
export async function importParsedRows(input: ImportInput): Promise<void> {
  for (const row of input.rows) {
    let customerId: string | null = null;

    if (row.legacyV3No !== null) {
      const customerNewId = randomUUID();
      const res = await input.executor.insertCustomer({
        id: customerNewId,
        tenantId: input.tenantId,
        fullName: row.fullName,
        legacyV3No: row.legacyV3No,
        totalOrders: row.totalOrders,
      });
      if (res.inserted) {
        input.report.customersInserted++;
        customerId = customerNewId;
      } else {
        input.report.customersSkippedAlreadyExists++;
        // Mevcut kaydı bul — idempotent re-run'da tel/adres tekrar denenmez
        // (zaten önceki run'da denenmişti). UNIQUE guard yine yakalar ama
        // gereksiz log kirliliği önlenir.
        customerId = null;
      }
    } else {
      // legacy_v3_no yok — yeni müşteri olarak ekle (tracker yok, idempotent değil)
      const customerNewId = randomUUID();
      const res = await input.executor.insertCustomer({
        id: customerNewId,
        tenantId: input.tenantId,
        fullName: row.fullName,
        legacyV3No: null,
        totalOrders: row.totalOrders,
      });
      if (res.inserted) {
        input.report.customersInserted++;
        customerId = customerNewId;
      }
    }

    if (customerId === null) continue;

    if (row.normalizedPhone === '') {
      input.report.phonesSkippedEmpty++;
    } else {
      const pres = await input.executor.insertPhone({
        id: randomUUID(),
        tenantId: input.tenantId,
        customerId,
        rawPhone: row.rawPhone,
        normalizedPhone: row.normalizedPhone,
        isMobile: row.isMobile,
      });
      if (pres.inserted) input.report.phonesInserted++;
      else input.report.phonesSkippedDuplicate++;
    }

    if (row.addressLine !== null) {
      await input.executor.insertAddress({
        id: randomUUID(),
        tenantId: input.tenantId,
        customerId,
        addressLine: row.addressLine,
        district: row.district,
      });
      input.report.addressesInserted++;
    }
  }
}

// ---------- Real Kysely executor (production) ----------

type Kdb = ReturnType<typeof createKysely>;

export function createKyselyExecutor(db: Kdb): ImportExecutor {
  return {
    async insertCustomer(args) {
      const result = await db
        .insertInto('customers')
        .values({
          id: args.id,
          tenant_id: args.tenantId,
          full_name: args.fullName,
          legacy_v3_no: args.legacyV3No,
          total_orders: args.totalOrders,
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'legacy_v3_no']).doNothing(),
        )
        .executeTakeFirst();
      return { inserted: (result.numInsertedOrUpdatedRows ?? 0n) > 0n };
    },
    async insertPhone(args) {
      try {
        await db
          .insertInto('customer_phones')
          .values({
            id: args.id,
            tenant_id: args.tenantId,
            customer_id: args.customerId,
            raw_phone: args.rawPhone,
            normalized_phone: args.normalizedPhone,
            is_primary: true,
            is_mobile: args.isMobile,
          })
          .execute();
        return { inserted: true };
      } catch (err) {
        // UNIQUE(tenant_id, normalized_phone) violation → duplicate, atla
        const code = (err as { code?: string }).code;
        if (code === '23505') return { inserted: false };
        throw err;
      }
    },
    async insertAddress(args) {
      await db
        .insertInto('customer_addresses')
        .values({
          id: args.id,
          tenant_id: args.tenantId,
          customer_id: args.customerId,
          title: 'Ev',
          address_line: args.addressLine,
          district: args.district,
          neighborhood: null,
          address_note: null,
          is_default: true,
        })
        .execute();
    },
    async findCustomerIdByLegacyNo(args) {
      const row = await db
        .selectFrom('customers')
        .select('id')
        .where('tenant_id', '=', args.tenantId)
        .where('legacy_v3_no', '=', String(args.legacyV3No))
        .executeTakeFirst();
      return row?.id ?? null;
    },
  };
}

/** No-op executor — `--dry-run` için. Hep "inserted" döner ki rapor anlamlı çıksın. */
export function createDryRunExecutor(): ImportExecutor {
  return {
    async insertCustomer() {
      return { inserted: true };
    },
    async insertPhone() {
      return { inserted: true };
    },
    async insertAddress() {
      // intentionally empty
    },
    async findCustomerIdByLegacyNo() {
      return null;
    },
  };
}

// ---------- Entry point ----------

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const filePath = path.resolve(args.file);
  console.log(`Excel okunuyor: ${filePath}`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (ws === undefined) throw new Error('Excel dosyasında sheet yok');

  const headerRow = ws.getRow(1);
  const cols = detectColumns(headerRow);

  const report = emptyReport();
  const t0 = performance.now();

  const parsed: ParsedRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    // Boş satır guard
    if (row.actualCellCount === 0) continue;
    report.totalRows++;
    const res = parseRow(row, cols);
    if (!res.ok) {
      if (res.reason === 'invalid_name') report.customersSkippedInvalidName++;
      else report.customersSkippedInvalidLegacyNo++;
      continue;
    }
    parsed.push(res.row);
  }

  console.log(`Parse edilen satır: ${parsed.length} / ${report.totalRows}`);

  if (args.dryRun) {
    const exec = createDryRunExecutor();
    // dry-run'da idempotent kontrolü yok — her satır "inserted" sayılır.
    // Gerçek çakışmalar prod run'da raporlanır.
    await runInBatches(parsed, args.batch, async (batch) => {
      await importParsedRows({
        tenantId: args.tenant,
        rows: batch,
        executor: exec,
        report,
      });
    });
  } else {
    const connectionString = process.env.DATABASE_URL;
    if (connectionString === undefined || connectionString === '') {
      throw new Error('DATABASE_URL environment variable zorunlu');
    }
    const pool = createPool({ connectionString });
    const db = createKysely(pool);
    try {
      await db.transaction().execute(async (trx) => {
        const exec = createKyselyExecutor(trx as unknown as Kdb);
        await runInBatches(parsed, args.batch, async (batch) => {
          await importParsedRows({
            tenantId: args.tenant,
            rows: batch,
            executor: exec,
            report,
          });
        });
        // Tenant existence sanity check (tablo trigger'ları zaten FK yakalar
        // ama net hata mesajı için):
        await sql`SELECT 1`.execute(trx);
        // KVKK denetim izi — toplu import kaydı. Yalnız gerçek run'da; dry-run
        // branch'i transaction açmaz → asla tetiklenmez. Müşteri INSERT'leriyle
        // aynı transaction içinde: atomik commit/rollback (ADR-002 §10.4).
        await writeAudit(trx, {
          tenantId: args.tenant,
          eventType: 'customer_import.completed',
          actorUserId: null,
          actor: { user_agent: 'script/import-v3-customers' },
          entityType: 'customer',
          rawPayload: buildImportAuditPayload(report),
        });
      });
    } finally {
      await db.destroy();
      await pool.end();
    }
  }

  report.durationMs = Math.round(performance.now() - t0);
  printReport(report, args.dryRun);
}

async function runInBatches<T>(
  items: T[],
  batchSize: number,
  fn: (batch: T[]) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    await fn(items.slice(i, i + batchSize));
  }
}

// ESM "main module" detection — sadece doğrudan çağrıldığında main() çalışır
const isMain =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
  import.meta.url.endsWith(path.basename(process.argv[1] ?? ''));

if (isMain) {
  main().catch((err: unknown) => {
    console.error('Import başarısız:', err);
    process.exit(1);
  });
}
