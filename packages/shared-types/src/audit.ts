import { z } from 'zod';

export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid().nullable(),
  actorUserId: z.string().uuid().nullable(),
  eventType: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

export const AuditEventTypeSchema = z.enum([
  'auth.login', 'auth.logout', 'auth.refresh',
  'order.created', 'order.cancelled', 'order.paid',
  'payment.created', 'payment.refunded',
  'user.created', 'user.updated', 'user.deleted',
  // ADR-003 §8.6 product lifecycle (Görev 18)
  'product.created', 'product.updated', 'product.deleted',
  'audit.purge',
]);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;
