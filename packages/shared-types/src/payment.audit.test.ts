import { describe, it, expect } from 'vitest';
import {
  PaymentTypeSchema,
  PaymentScopeSchema,
  PaymentVoidReasonSchema,
  PaymentOperationSchema,
  PaymentItemAllocationInputSchema,
  PaymentCreateRequestSchema,
  PaymentVoidRequestSchema,
  PaymentVoidResponseSchema,
} from './payment.js';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const VALID_UUID_2 = '22222222-2222-4222-8222-222222222222';

describe('PaymentTypeSchema / PaymentScopeSchema — enum, DB paritesi (Migration 001)', () => {
  it('cash/card/transfer kabul eder (payment_type DB enum ile hizalı)', () => {
    expect(PaymentTypeSchema.safeParse('cash').success).toBe(true);
    expect(PaymentTypeSchema.safeParse('card').success).toBe(true);
    expect(PaymentTypeSchema.safeParse('transfer').success).toBe(true);
  });

  it('tanımsız payment type reddeder', () => {
    expect(PaymentTypeSchema.safeParse('bitcoin').success).toBe(false);
  });

  it('full/partial/item kabul eder (payment_scope DB enum ile hizalı — eski adlar full_order/split_item/equal_split RENAME edildi)', () => {
    expect(PaymentScopeSchema.safeParse('full').success).toBe(true);
    expect(PaymentScopeSchema.safeParse('partial').success).toBe(true);
    expect(PaymentScopeSchema.safeParse('item').success).toBe(true);
  });

  it('eski (RENAME öncesi) DB değer adlarını reddeder', () => {
    expect(PaymentScopeSchema.safeParse('full_order').success).toBe(false);
    expect(PaymentScopeSchema.safeParse('equal_split').success).toBe(false);
  });
});

describe('PaymentVoidReasonSchema — ADR-033 K6 enum', () => {
  it('tanımlı 5 sebep kodunu kabul eder', () => {
    for (const v of ['wrong_payment_type', 'wrong_amount', 'wrong_table', 'duplicate', 'other']) {
      expect(PaymentVoidReasonSchema.safeParse(v).success, v).toBe(true);
    }
  });

  it('serbest metin sebep REDDEDİLİR (PII sızıntısı önlemi — enum tasarım amacı)', () => {
    expect(PaymentVoidReasonSchema.safeParse('müşteri adı Ahmet yanlış yazdı').success).toBe(false);
  });
});

describe('PaymentOperationSchema — 4 operasyon', () => {
  it('geçerli operasyonları kabul eder', () => {
    for (const v of ['pay', 'pay_and_close', 'pay_and_print', 'pay_and_print_close']) {
      expect(PaymentOperationSchema.safeParse(v).success, v).toBe(true);
    }
  });
});

describe('PaymentItemAllocationInputSchema — quantity sınırı', () => {
  it('pozitif integer kabul eder', () => {
    expect(
      PaymentItemAllocationInputSchema.safeParse({ orderItemId: VALID_UUID, quantity: 1 }).success,
    ).toBe(true);
  });

  it('quantity 0 reddeder', () => {
    expect(
      PaymentItemAllocationInputSchema.safeParse({ orderItemId: VALID_UUID, quantity: 0 }).success,
    ).toBe(false);
  });

  it('quantity float reddeder', () => {
    expect(
      PaymentItemAllocationInputSchema.safeParse({ orderItemId: VALID_UUID, quantity: 2.5 }).success,
    ).toBe(false);
  });

  it('orderItemId geçersiz UUID reddeder', () => {
    expect(
      PaymentItemAllocationInputSchema.safeParse({ orderItemId: 'kalem-1', quantity: 1 }).success,
    ).toBe(false);
  });
});

describe('PaymentCreateRequestSchema — refine zinciri', () => {
  const base = {
    orderId: VALID_UUID,
    paymentType: 'cash' as const,
    paymentScope: 'full' as const,
    amountCents: 15_000,
    idempotencyKey: VALID_UUID_2,
  };

  it('geçerli full-scope pay kabul eder', () => {
    expect(PaymentCreateRequestSchema.safeParse(base).success).toBe(true);
  });

  it('amountCents 0 reddeder (refine v > 0 — MoneyCentsSchema tek başına 0 kabul ederdi)', () => {
    expect(PaymentCreateRequestSchema.safeParse({ ...base, amountCents: 0 }).success).toBe(false);
  });

  it('amountCents negatif reddeder', () => {
    expect(PaymentCreateRequestSchema.safeParse({ ...base, amountCents: -100 }).success).toBe(false);
  });

  it('orderItemIds VE itemAllocations birlikte verilirse reddeder', () => {
    const r = PaymentCreateRequestSchema.safeParse({
      ...base,
      paymentScope: 'item',
      orderItemIds: [VALID_UUID],
      itemAllocations: [{ orderItemId: VALID_UUID, quantity: 1 }],
    });
    expect(r.success).toBe(false);
  });

  it('paymentScope=item ama allocation/id yoksa reddeder', () => {
    const r = PaymentCreateRequestSchema.safeParse({ ...base, paymentScope: 'item' });
    expect(r.success).toBe(false);
  });

  it('pay_and_close + paymentScope != full reddeder', () => {
    const r = PaymentCreateRequestSchema.safeParse({
      ...base,
      paymentScope: 'partial',
      operation: 'pay_and_close',
    });
    expect(r.success).toBe(false);
  });

  it('idempotencyKey geçersiz UUID reddeder', () => {
    expect(
      PaymentCreateRequestSchema.safeParse({ ...base, idempotencyKey: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('payerNo 1..999 aralığını zorlar', () => {
    expect(PaymentCreateRequestSchema.safeParse({ ...base, payerNo: 0 }).success).toBe(false);
    expect(PaymentCreateRequestSchema.safeParse({ ...base, payerNo: 1000 }).success).toBe(false);
    expect(PaymentCreateRequestSchema.safeParse({ ...base, payerNo: 500 }).success).toBe(true);
  });

  it('note 500 karakter kabul, 501 reddeder', () => {
    expect(PaymentCreateRequestSchema.safeParse({ ...base, note: 'a'.repeat(500) }).success).toBe(true);
    expect(PaymentCreateRequestSchema.safeParse({ ...base, note: 'a'.repeat(501) }).success).toBe(false);
  });
});

describe('PaymentVoidRequestSchema', () => {
  it('reasonCode zorunlu — eksikse reddeder', () => {
    expect(PaymentVoidRequestSchema.safeParse({}).success).toBe(false);
  });

  it('geçerli reasonCode kabul eder', () => {
    expect(PaymentVoidRequestSchema.safeParse({ reasonCode: 'duplicate' }).success).toBe(true);
  });
});

/**
 * Bulgu: SD-T-A-05 [MEDIUM][QUAL] PaymentVoidResponseSchema kendi JSDoc
 * sözleşmesini tam karşılamıyor. JSDoc (payment.ts:175-181) "POST
 * /payments/:paymentId/void yanıtı — `{ payment, order, reopened }`" der;
 * şema (payment.ts:182-186) yalnız `{ payment, reopened }` tanımlıyor —
 * `order` alanı EKSİK. Şema repo genelinde tüketilmiyor (grep: yalnız kendi
 * dosyasında) — şu an dead + drift kombinasyonu, düşük gerçek etki ama
 * biri bu şemayı response validasyonu için kullanmaya başlarsa
 * `result.data.order` tip güvencesiz kalır. Bu test MEVCUT (eksik) durumu
 * belgeler — bilerek YEŞİL (gerçeği doğruluyor, arzu edilen davranışı değil).
 * Öneri: `order` alanı eklenmeli veya JSDoc güncellenmeli. Etiket: v5.1-backlog
 */
describe('SD-T-A-05 — PaymentVoidResponseSchema "order" alanı eksik (mevcut durum belgesi)', () => {
  it('şema shape\'inde "order" anahtarı YOK — JSDoc sözleşmesiyle uyuşmuyor', () => {
    const shape = PaymentVoidResponseSchema.shape as unknown as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(shape, 'order')).toBe(false);
  });
});
