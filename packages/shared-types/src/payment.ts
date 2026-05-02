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

/** payment_items junction satırı — Migration 023 sonrası quantity-aware.
 *  Aynı order_item_id N farklı payment_items satırına bağlanabilir
 *  (UNIQUE constraint kaldırıldı, ADR-014 §9 Karar 9.4 v3 paritesi).
 *  Snapshot kuralı: insert anında order_items.unit_price_cents kopyalanır.
 *  line_total_cents = quantity × unit_price_cents_snapshot (CHECK constraint). */
export const PaymentItemLinkSchema = z.object({
  paymentId: z.string().uuid(),
  orderItemId: z.string().uuid(),
  quantity: z.number().int().positive(),
  unitPriceCentsSnapshot: MoneyCentsSchema,
  lineTotalCents: MoneyCentsSchema,
});
export type PaymentItemLink = z.infer<typeof PaymentItemLinkSchema>;

/** POST /payments body içindeki tek allocation — Migration 023 quantity. */
export const PaymentItemAllocationInputSchema = z.object({
  orderItemId: z.string().uuid(),
  quantity: z.number().int().positive(),
});
export type PaymentItemAllocationInput = z.infer<
  typeof PaymentItemAllocationInputSchema
>;

/** payments satırı (Migration 022 + 024 sonrası). */
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
  payerNo: z.number().int().min(1).max(999).nullable(),
  payerLabel: z.string().nullable(),
  cashReceivedCents: MoneyCentsSchema.nullable(),
  changeAmountCents: MoneyCentsSchema.nullable(),
  tipAmountCents: MoneyCentsSchema.nullable(),
  note: z.string().nullable(),
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
    /** ADR-014 §10 Karar 10.5 — Hızlı Öde nakit modunda otomatik = amountCents,
     *  Ayrı Ayrı Öde'de kullanıcı girer. NULL allowed (kart ödemesi). */
    cashReceivedCents: MoneyCentsSchema.optional(),
    /** ADR-014 §11 Karar 11.3 — DETAYLI ÖDEME bahşiş input (Migration 025). */
    tipAmountCents: MoneyCentsSchema.optional(),
    /** ADR-014 §10 Karar 10.5 — Ayrı Ayrı Öde payer no (1-999) + label.
     *  paymentScope='item' için anlamlı; full/partial scope'ta backend yok sayar. */
    payerNo: z.number().int().min(1).max(999).optional(),
    payerLabel: z.string().max(80).optional(),
    /** Kasiyer notu (rapor için). */
    note: z.string().max(500).optional(),
    /** ADR-014 §9 Karar 9.4 — partial-qty allocations.
     *  Geriye uyumluluk: `orderItemIds` (string[]) hâlâ kabul, sunucu her id
     *  için quantity=order_items.quantity ile genişletir. Yeni client'lar
     *  doğrudan `itemAllocations` gönderir. İkisi aynı anda VERILMEZ. */
    itemAllocations: z
      .array(PaymentItemAllocationInputSchema)
      .max(99)
      .optional(),
    orderItemIds: z.array(z.string().uuid()).max(99).optional(),
  })
  .refine(
    (d) => !(d.orderItemIds !== undefined && d.itemAllocations !== undefined),
    {
      message: 'payment.bothAllocationsAndIdsForbidden',
      path: ['itemAllocations'],
    },
  )
  .refine(
    (d) =>
      d.paymentScope !== 'item' ||
      (d.itemAllocations?.length ?? 0) > 0 ||
      (d.orderItemIds?.length ?? 0) > 0,
    { message: 'payment.itemScopeRequiresAllocations', path: ['itemAllocations'] },
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
