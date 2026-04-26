import { z } from 'zod';
import { MoneyCentsSchema } from './money.js';

export const OrderStatusSchema = z.enum([
  'open', 'sent_to_kitchen', 'partially_served',
  'served', 'billed', 'paid', 'cancelled', 'void',
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderTypeSchema = z.enum(['dine_in', 'takeaway', 'delivery']);
export type OrderType = z.infer<typeof OrderTypeSchema>;

export const OrderItemSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  productNameSnapshot: z.string(),
  unitPriceCents: MoneyCentsSchema,
  quantity: z.number().int().positive(),
  isComp: z.boolean(),
  compReason: z.string().nullable(),
  isCancelled: z.boolean(),
  cancelReason: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

export const OrderRowSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  tableId: z.string().uuid().nullable(),
  orderType: OrderTypeSchema,
  status: OrderStatusSchema,
  storeDate: z.string(),
  orderNo: z.number().int().positive(),
  waiterUserId: z.string().uuid().nullable(),
  note: z.string().nullable(),
  totalCents: MoneyCentsSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type OrderRow = z.infer<typeof OrderRowSchema>;

export const OrderCreateRequestSchema = z.object({
  tenantId: z.string().uuid(),
  tableId: z.string().uuid().nullable(),
  orderType: OrderTypeSchema,
  waiterUserId: z.string().uuid().nullable(),
  note: z.string().optional(),
});
export type OrderCreateRequest = z.infer<typeof OrderCreateRequestSchema>;

export const OrderCreateApiRequestSchema = z.object({
  tableId: z.string().uuid().nullable(),
  orderType: OrderTypeSchema,
  note: z.string().max(500).optional(),
  customerId: z.string().uuid().optional(),
}).refine(
  (data) => data.orderType !== 'dine_in' || data.tableId !== null,
  { message: 'order.tableRequiredForDineIn', path: ['tableId'] }
);
export type OrderCreateApiRequest = z.infer<typeof OrderCreateApiRequestSchema>;

export const OrderListQuerySchema = z.object({
  status: OrderStatusSchema.optional(),
  tableId: z.string().uuid().optional(),
  storeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  orderType: OrderTypeSchema.optional(),
});
export type OrderListQuery = z.infer<typeof OrderListQuerySchema>;
