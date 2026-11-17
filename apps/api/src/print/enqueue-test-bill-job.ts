/**
 * ADR-045 K7 — Fiş Ayarları ekranının "Deneme fişi bas" eylemi.
 *
 * İşletmenin KAYITLI fiş metniyle (kill-switch dahil, `resolveTenantReceiptText`)
 * sabit örnek kalemli bir adisyon çizer ve gerçek kuyruğa `kind: 'bill'` olarak
 * yazar — yani kasa fişiyle aynı yazıcıya, aynı yoldan gider.
 *
 * Sipariş / ödeme satırı OLUŞTURULMAZ. `payload.meta` sipariş taşımaz
 * (`test: true`); kuyruktaki hiçbir okuyucu (ajan, iş listesi uçları, web)
 * `meta.orderId`'ye dayanmaz — PR-2'de koddan doğrulandı.
 *
 * Hedef yazıcının tenant/revoked doğrulaması ÇAĞIRANIN işidir (`print-bill`
 * ile aynı sözleşme); buraya yalnız doğrulanmış id gelir.
 */

import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { ESC_POS } from '@restoran-pos/shared-domain';
import { renderBillReceipt } from './templates/bill-receipt.js';
import { formatReceiptDateTime } from './format-receipt-datetime.js';
import { RECEIPT_TEXT_COLUMNS, resolveTenantReceiptText } from './receipt-text-settings.js';

export interface TestBillJobInput {
  tenantId: string;
  actorUserId: string;
  targetAgentId?: string | undefined;
}

/** Sabit örnek kalemler — fişin gövdesi gerçek bir adisyon gibi görünsün diye. */
const SAMPLE_ITEMS = [
  { name: 'Örnek ürün', qty: 2, variantName: null, lineTotalCents: 30000, note: null, modifiers: [] },
  { name: 'Örnek içecek', qty: 2, variantName: null, lineTotalCents: 8000, note: null, modifiers: [] },
] as const;
const SAMPLE_TOTAL_CENTS = 38000;

export async function enqueueTestBillJob(
  db: Kysely<DB>,
  input: TestBillJobInput,
): Promise<void> {
  const { tenantId } = input;

  const tenant = await db
    .selectFrom('tenants')
    .select(['name'])
    .where('id', '=', tenantId)
    .executeTakeFirstOrThrow();
  const settings = await db
    .selectFrom('tenant_settings')
    .select(['timezone', ...RECEIPT_TEXT_COLUMNS])
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();
  const timezone = settings?.timezone ?? 'Europe/Istanbul';
  const receiptText = resolveTenantReceiptText(settings, tenantId);

  const renderedAt = new Date().toISOString();
  const bytes = renderBillReceipt(
    {
      tenant_header: tenant.name,
      order_no: 0,
      order_type: 'dine_in',
      server_name: null,
      table_label: 'Masa 1',
      area_label: null,
      items: SAMPLE_ITEMS.map((it) => ({ ...it, modifiers: [...it.modifiers] })),
      totalCents: SAMPLE_TOTAL_CENTS,
      payments: [],
      paidTotalCents: 0,
      remainingCents: SAMPLE_TOTAL_CENTS,
      created_at_local: formatReceiptDateTime(renderedAt, timezone),
      order_note: null,
      receipt_text: receiptText,
      test_marker: true,
    },
    ESC_POS.CODEPAGE_CP857_PAGE61,
  );

  await db
    .insertInto('print_jobs')
    .values({
      id: randomUUID(),
      tenant_id: tenantId,
      status: 'queued',
      target_agent_id: input.targetAgentId ?? null,
      payload: {
        kind: 'bill',
        bytesBase64: Buffer.from(bytes).toString('base64'),
        meta: {
          test: true,
          actorUserId: input.actorUserId,
          renderedAt,
        },
      },
    })
    .execute();
}
