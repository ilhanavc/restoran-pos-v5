import { describe, it, expect } from 'vitest';
import {
  PaymentItemAllocationInputSchema,
  PaymentItemLinkSchema,
  PaymentSchema,
} from './payment.js';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

/**
 * Blok 2 / Hat A — KASITLI KIRMIZI karakterizasyon testleri (payment.ts).
 */

/**
 * Bulgu: SD-T-A-03 [HIGH][BUG] PaymentItemAllocationInputSchema.quantity ve
 * PaymentItemLinkSchema.quantity üst sınırsız.
 *
 * Kanıt: payment.ts:55,64 — `quantity: z.number().int().positive()`, `.max()`
 * YOK. Kardeş şema OrderItemCreateInputSchema.quantity (order.ts:64) ise
 * `.max(99)` ile sınırlı. payment_items.line_total_cents = quantity ×
 * unit_price_cents_snapshot (Migration 023 CHECK constraint) — quantity
 * sınırsız int kabul ederse, aşırı büyük bir değer (ör. 999_999_999) zod'dan
 * geçer; DB CHECK aritmetiği veya line_total_cents (INTEGER) taşabilir,
 * temiz 400 yerine ham Postgres hatası (500) döner.
 *
 * Öneri: PaymentItemAllocationInputSchema.quantity ve PaymentItemLinkSchema
 * .quantity'e OrderItemCreateInputSchema ile tutarlı `.max(99)` (veya en
 * azından gerçekçi bir üst sınır) eklenmeli.
 * Etiket: MVP-fix
 */
describe('SD-T-A-03 — payment_items quantity üst sınırsız (kasıtlı kırmızı)', () => {
  it('SD-T-A-03a PaymentItemAllocationInputSchema.quantity gerçekçi-olmayan büyük değeri reddetmeli', () => {
    const r = PaymentItemAllocationInputSchema.safeParse({
      orderItemId: VALID_UUID,
      quantity: 999_999_999,
    });
    // Beklenen (doğru) davranış: reddet (order.ts quantity.max(99) ile tutarlı
    // bir üst sınır olmalı). Şu an: kabul ediyor → KIRMIZI.
    expect(r.success).toBe(false);
  });

  it('SD-T-A-03b PaymentItemLinkSchema.quantity aynı sınırsızlığı taşır', () => {
    const r = PaymentItemLinkSchema.safeParse({
      paymentId: VALID_UUID,
      orderItemId: VALID_UUID,
      quantity: 999_999_999,
      unitPriceCentsSnapshot: 100,
      lineTotalCents: 100, // gerçekte tutarsız olurdu ama şema quantity×fiyatı çarpmıyor
    });
    expect(r.success).toBe(false);
  });
});

describe('PaymentSchema — entity şeması (tüketim referansı, YEŞİL)', () => {
  it('voidedAt/voidedByUserId/voidReasonCode üçü birden NULL geçerli (aktif ödeme)', () => {
    const validPayment = {
      id: VALID_UUID,
      orderId: VALID_UUID,
      tenantId: VALID_UUID,
      paymentType: 'cash' as const,
      paymentScope: 'full' as const,
      amountCents: 5000,
      idempotencyKey: VALID_UUID,
      createdByUserId: null,
      createdAt: '2026-07-11T10:00:00.000Z',
      payerNo: null,
      payerLabel: null,
      cashReceivedCents: null,
      changeAmountCents: null,
      tipAmountCents: null,
      note: null,
      voidedAt: null,
      voidedByUserId: null,
      voidReasonCode: null,
    };
    expect(PaymentSchema.safeParse(validPayment).success).toBe(true);
  });
});
