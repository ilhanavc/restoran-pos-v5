import { z } from 'zod';
import { MoneyCentsSchema } from './money.js';

/** ADR-014 Karar 2 — MVP: cash + card. transfer DB enum'da hazır, MVP'de
 *  UI vermez ama API kabul eder (raporlama uyumu). */
export const PaymentTypeSchema = z.enum(['cash', 'card', 'transfer']);
export type PaymentType = z.infer<typeof PaymentTypeSchema>;

/** ADR-003 §10.1 + ADR-014 §5 — DB enum paritesi:
 *   - 'full'    → tek payment, tüm sipariş kapanır
 *   - 'item'    → kalem bazlı bölünmüş; payment_items junction zorunlu
 *   - 'partial' → tutar bazlı / eşit pay; payment_items YOK
 */
export const PaymentScopeSchema = z.enum(['full', 'partial', 'item']);
export type PaymentScope = z.infer<typeof PaymentScopeSchema>;

/** ADR-014 Karar 1 — Hızlı Öde 4-operation:
 *   - pay            → masa açık kalır
 *   - pay_and_close  → masa kapanır (orders.status='paid')
 *   - pay_and_print  → ödeme + receipt print
 *   - pay_and_print_close → hepsi
 * `*close` operasyonları paymentScope='full' gerektirir (Karar 6 atomicity).
 */
export const PaymentOperationSchema = z.enum([
  'pay',
  'pay_and_close',
  'pay_and_print',
  'pay_and_print_close',
]);
export type PaymentOperation = z.infer<typeof PaymentOperationSchema>;

/** payment_items junction satırı — DB tek bir link tablosu (id YOK,
 *  amount_cents YOK; ADR-003 §10.1.b). Migration 022 öncesi shared-types
 *  yanıltıcıydı (id + amountCents üretiyordu) — DB ile hizalandı. */
export const PaymentItemLinkSchema = z.object({
  paymentId: z.string().uuid(),
  orderItemId: z.string().uuid(),
});
export type PaymentItemLink = z.infer<typeof PaymentItemLinkSchema>;

/** payments satırı (Migration 022 sonrası). */
export const PaymentSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  tenantId: z.string().uuid(),
  paymentType: PaymentTypeSchema,
  paymentScope: PaymentScopeSchema,
  amountCents: MoneyCentsSchema,
  idempotencyKey: z.string().uuid(),
  createdByUserId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type Payment = z.infer<typeof PaymentSchema>;

/**
 * POST /payments body — ADR-014 Karar 1 + 4 + 5.
 *
 * `idempotencyKey`: UI üretir (uuid v4); aynı (tenant, key) ikinci çağrıda
 * sunucu mevcut payment'ı döner (replay safety).
 *
 * `paymentScope='item'`: `orderItemIds[]` zorunlu, en az 1 öğe; sunucu
 * `payment_items` junction'ı INSERT eder (DB trigger comped item'ı reddeder).
 *
 * `operation` *close ile bitiyorsa `paymentScope='full'` zorunlu (ADR-014 §6
 * "tek transaction" full payment gerektirir).
 */
export const PaymentCreateRequestSchema = z
  .object({
    orderId: z.string().uuid(),
    paymentType: PaymentTypeSchema,
    paymentScope: PaymentScopeSchema,
    amountCents: MoneyCentsSchema.refine((v) => v > 0, {
      message: 'payment.amountMustBePositive',
    }),
    idempotencyKey: z.string().uuid(),
    operation: PaymentOperationSchema.default('pay'),
    orderItemIds: z.array(z.string().uuid()).max(99).optional(),
  })
  .refine(
    (d) => d.paymentScope !== 'item' || (d.orderItemIds?.length ?? 0) > 0,
    { message: 'payment.itemScopeRequiresOrderItemIds', path: ['orderItemIds'] },
  )
  .refine(
    (d) =>
      d.operation !== 'pay_and_close' &&
      d.operation !== 'pay_and_print_close'
        ? true
        : d.paymentScope === 'full',
    { message: 'payment.closeRequiresFullScope', path: ['paymentScope'] },
  );
export type PaymentCreateRequest = z.infer<typeof PaymentCreateRequestSchema>;
