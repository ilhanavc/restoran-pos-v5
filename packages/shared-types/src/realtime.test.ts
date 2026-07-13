import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  OrderCreatedPayloadSchema,
  OrderStatusChangedPayloadSchema,
  OrderCancelledPayloadSchema,
  OrderCustomerAssignedPayloadSchema,
  KitchenOrderSentPayloadSchema,
  KitchenItemStatusChangedPayloadSchema,
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

/**
 * ADR-010 §11.3 Amendment K1/K2 — KDS (`kitchen.*`) payload şema hizalaması.
 * K1: `items[].qty` → `quantity` (runtime her yerde `quantity`; şema tek
 * aykırıydı). K2: `tableId` present-nullable → `.optional()` (emit-side hiç
 * göndermiyor + receive invalidate-only; wire değişmez → non-breaking).
 */
describe('kitchen.* realtime payload schemas (ADR-010 §11.3 amendment)', () => {
  describe('KitchenOrderSentPayloadSchema', () => {
    const item = {
      id: randomUUID(),
      productName: 'Kuşbaşılı Pide',
      quantity: 2,
    };
    const valid = {
      orderId: randomUUID(),
      orderType: 'dine_in' as const,
      items: [item],
    };

    it('tableId olmadan parse eder (K2 — .optional())', () => {
      // Emit-site tableId göndermiyor; absent kabul edilmeli (parse THROW etmez).
      const r = KitchenOrderSentPayloadSchema.safeParse(valid);
      expect(r.success).toBe(true);
    });

    it('tableId null kabul eder (present-but-null)', () => {
      const r = KitchenOrderSentPayloadSchema.safeParse({
        ...valid,
        tableId: null,
      });
      expect(r.success).toBe(true);
    });

    it('tableId uuid kabul eder (present-uuid)', () => {
      const r = KitchenOrderSentPayloadSchema.safeParse({
        ...valid,
        tableId: randomUUID(),
      });
      expect(r.success).toBe(true);
    });

    it('takeaway orderType parse eder', () => {
      const r = KitchenOrderSentPayloadSchema.safeParse({
        ...valid,
        orderType: 'takeaway',
      });
      expect(r.success).toBe(true);
    });

    it('items[].quantity zorunlu (K1 — qty alanı artık yok)', () => {
      const r = KitchenOrderSentPayloadSchema.safeParse({
        ...valid,
        items: [{ id: randomUUID(), productName: 'Lahmacun', qty: 2 }],
      });
      expect(r.success).toBe(false);
    });

    it('quantity pozitif tamsayı olmalı (0 ve negatif reddedilir)', () => {
      expect(
        KitchenOrderSentPayloadSchema.safeParse({
          ...valid,
          items: [{ ...item, quantity: 0 }],
        }).success,
      ).toBe(false);
      expect(
        KitchenOrderSentPayloadSchema.safeParse({
          ...valid,
          items: [{ ...item, quantity: 1.5 }],
        }).success,
      ).toBe(false);
    });

    it('non-UUID orderId reddeder', () => {
      const r = KitchenOrderSentPayloadSchema.safeParse({
        ...valid,
        orderId: 'not-a-uuid',
      });
      expect(r.success).toBe(false);
    });

    it('geçersiz orderType reddeder', () => {
      const r = KitchenOrderSentPayloadSchema.safeParse({
        ...valid,
        orderType: 'pickup',
      });
      expect(r.success).toBe(false);
    });
  });

  describe('KitchenItemStatusChangedPayloadSchema', () => {
    const valid = {
      orderId: randomUUID(),
      itemId: randomUUID(),
      status: 'preparing' as const,
    };

    it('geçerli payload parse eder', () => {
      expect(KitchenItemStatusChangedPayloadSchema.safeParse(valid).success).toBe(
        true,
      );
    });

    it('ready status parse eder', () => {
      expect(
        KitchenItemStatusChangedPayloadSchema.safeParse({
          ...valid,
          status: 'ready',
        }).success,
      ).toBe(true);
    });

    it('geçersiz status reddeder', () => {
      expect(
        KitchenItemStatusChangedPayloadSchema.safeParse({
          ...valid,
          status: 'sent',
        }).success,
      ).toBe(false);
    });
  });
});
