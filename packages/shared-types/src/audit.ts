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
  // Sprint 4 Görev 19 — table lifecycle (admin CRUD)
  'table.created', 'table.updated', 'table.deleted',
  // Sprint 5 Görev 23 — table-area assignment (PATCH /tables/:id/area).
  // Ayrı event type: bölge ataması update'inden ayrıştırılır (raporlama:
  // hangi masa hangi bölgeye ne zaman atandı log'lanır).
  'table.area_assigned',
  // Sprint 4 Görev 20 — menu category lifecycle (admin PATCH/DELETE).
  // Underscore (`menu_category`) — DB CHECK `^[a-z_]+\.[a-z_]+$` 2 segment
  // (entity.action) gerektiriyor; 3-part `menu.category.*` constraint'i ihlal
  // ederdi (000_init.sql L361).
  'menu_category.updated', 'menu_category.deleted',
  // Sprint 5 Görev 23 — area lifecycle (admin CRUD, ADR-009 Karar 4).
  // DELETE `tables_unlinked_count` cascade NULL sayısını yazar (ADR-009 Domain
  // service Karar 5).
  'area.created', 'area.updated', 'area.deleted',
  // Sprint 6 Görev 24 — tenant settings PATCH (ADR-002 §6 amendment).
  // Yalnız `timezone` + `business_day_cutoff_hour` MVP kapsamında.
  'settings.updated',
  'audit.purge',
]);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;
