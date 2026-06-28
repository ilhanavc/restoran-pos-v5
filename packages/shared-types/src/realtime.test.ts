import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  OrderCreatedPayloadSchema,
  OrderStatusChangedPayloadSchema,
  OrderCancelledPayloadSchema,
  OrderCustomerAssignedPayloadSchema,
} from './realtime.js';

/**
 * ADR-010 §11 Amendment (2026-06-28) / ADR-025 K5 — `orders.*` realtime
 * payload schema doğrulamaları. Event'ler `apps/api/src/routes/orders.ts`
 * mevcut emit'lerinden formalize edildi (colon-string → dot-notation).
 *
 * Bu testler shared-types saf zod kontratını doğrular: geçerli payload parse
 * edilir, geçersiz (eksik/yanlış-tip/non-UUID/negatif kuruş) reddedilir.
 * Emit-path entegrasyonu (event ismi + zod parse) apps/api orders.test.ts'te.
 */

describe('orders.* realtime payload schemas (ADR-010 §11 amendment)', () => {
  describe('OrderCreatedPayloadSchema', () => {
    const valid = {
      orderId: randomUUID(),
      type: 'takeaway' as const,
      takeawayStage: 'preparing' as const,
      total_cents: 5000,
    };

    it('geçerli payload parse eder', () => {
      expect(() => OrderCreatedPayloadSchema.parse(valid)).not.toThrow();
    });

    it('total_cents sıfır kabul eder (nonnegative)', () => {
      expect(() =>
        OrderCreatedPayloadSchema.parse({ ...valid, total_cents: 0 }),
      ).not.toThrow();
    });

    it('negatif total_cents reddeder', () => {
      const r = OrderCreatedPayloadSchema.safeParse({
        ...valid,
        total_cents: -1,
      });
      expect(r.success).toBe(false);
    });

    it('float total_cents reddeder (integer kuruş)', () => {
      const r = OrderCreatedPayloadSchema.safeParse({
        ...valid,
        total_cents: 50.5,
      });
      expect(r.success).toBe(false);
    });

    it('geçersiz orderType reddeder', () => {
      const r = OrderCreatedPayloadSchema.safeParse({
        ...valid,
        type: 'pickup',
      });
      expect(r.success).toBe(false);
    });

    it('non-UUID orderId reddeder', () => {
      const r = OrderCreatedPayloadSchema.safeParse({
        ...valid,
        orderId: 'not-a-uuid',
      });
      expect(r.success).toBe(false);
    });

    it('eksik takeawayStage reddeder', () => {
      const { takeawayStage: _omit, ...rest } = valid;
      void _omit;
      const r = OrderCreatedPayloadSchema.safeParse(rest);
      expect(r.success).toBe(false);
    });
  });

  describe('OrderStatusChangedPayloadSchema', () => {
    const valid = {
      orderId: randomUUID(),
      takeawayStage: 'out_for_delivery' as const,
      paid: true,
    };

    it('geçerli payload parse eder', () => {
      expect(() =>
        OrderStatusChangedPayloadSchema.parse(valid),
      ).not.toThrow();
    });

    it('paid alanı boolean olmalı', () => {
      const r = OrderStatusChangedPayloadSchema.safeParse({
        ...valid,
        paid: 'yes',
      });
      expect(r.success).toBe(false);
    });

    it('geçersiz stage reddeder', () => {
      const r = OrderStatusChangedPayloadSchema.safeParse({
        ...valid,
        takeawayStage: 'shipped',
      });
      expect(r.success).toBe(false);
    });
  });

  describe('OrderCancelledPayloadSchema', () => {
    it('geçerli payload parse eder', () => {
      expect(() =>
        OrderCancelledPayloadSchema.parse({ orderId: randomUUID() }),
      ).not.toThrow();
    });

    it('non-UUID orderId reddeder', () => {
      const r = OrderCancelledPayloadSchema.safeParse({ orderId: '123' });
      expect(r.success).toBe(false);
    });
  });

  describe('OrderCustomerAssignedPayloadSchema', () => {
    const valid = {
      orderId: randomUUID(),
      customerId: randomUUID(),
    };

    it('geçerli payload parse eder', () => {
      expect(() =>
        OrderCustomerAssignedPayloadSchema.parse(valid),
      ).not.toThrow();
    });

    it('null customerId kabul eder (un-assign / dine_in)', () => {
      expect(() =>
        OrderCustomerAssignedPayloadSchema.parse({
          orderId: randomUUID(),
          customerId: null,
        }),
      ).not.toThrow();
    });

    it('non-UUID customerId reddeder', () => {
      const r = OrderCustomerAssignedPayloadSchema.safeParse({
        ...valid,
        customerId: 'nope',
      });
      expect(r.success).toBe(false);
    });

    it('eksik customerId reddeder', () => {
      const r = OrderCustomerAssignedPayloadSchema.safeParse({
        orderId: randomUUID(),
      });
      expect(r.success).toBe(false);
    });
  });
});
