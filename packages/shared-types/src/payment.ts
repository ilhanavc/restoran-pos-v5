import { z } from 'zod';
import { MoneyCentsSchema } from './money.js';

export const PaymentTypeSchema = z.enum(['cash', 'card', 'transfer', 'comp']);
export type PaymentType = z.infer<typeof PaymentTypeSchema>;

export const PaymentScopeSchema = z.enum(['full', 'partial', 'item']);
export type PaymentScope = z.infer<typeof PaymentScopeSchema>;

export const PaymentItemSchema = z.object({
  id: z.string().uuid(),
  paymentId: z.string().uuid(),
  orderItemId: z.string().uuid(),
  amountCents: MoneyCentsSchema,
});
export type PaymentItem = z.infer<typeof PaymentItemSchema>;

export const PaymentSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  tenantId: z.string().uuid(),
  paymentType: PaymentTypeSchema,
  paymentScope: PaymentScopeSchema,
  amountCents: MoneyCentsSchema,
  receivedCents: MoneyCentsSchema.nullable(),
  changeCents: MoneyCentsSchema.nullable(),
  note: z.string().nullable(),
  createdByUserId: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type Payment = z.infer<typeof PaymentSchema>;
