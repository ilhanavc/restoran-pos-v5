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
  'menu_category.updated', 'menu_category.deleted', 'menu_category.products_reordered',
  // Sprint 5 Görev 23 — area lifecycle (admin CRUD, ADR-009 Karar 4).
  // DELETE `tables_unlinked_count` cascade NULL sayısını yazar (ADR-009 Domain
  // service Karar 5).
  'area.created', 'area.updated', 'area.deleted',
  // Sprint 8c PR-C — POST /areas/:id/sync-tables (ADR-009 Amendment 2026-04-30).
  // 2-segment naming gerek (DB CHECK `^[a-z_]+\.[a-z_]+$`); `area_tables` namespace
  // altında added/removed event'leri sync sonucunu yazar.
  'area_tables.added', 'area_tables.removed',
  // Sprint 6 Görev 24 + ADR-015 — tenant settings PATCH (admin only). MVP scope:
  // sadece `timezone`. `changed_fields` payload'a hangi alanların değiştiği
  // yazılır; before/after değerler de yazılır (sayısal/string, PII değil).
  // Migration 026 cutoff_hour DROP ile birlikte cutoff_hour_* alanları çıkarıldı.
  'tenant_settings.updated',
  // ADR-015 Karar 10 — Migration 026 forensic snapshot.
  'tenant_settings.cutoff_deprecated',
  // Sprint 8c PR-F1 — attribute groups & options lifecycle (ADR-012).
  // 2-segment naming (DB CHECK `^[a-z_]+\.[a-z_]+$`).
  'attribute_group.created',
  'attribute_group.updated',
  'attribute_group.deleted',
  'attribute_option.created',
  'attribute_option.updated',
  'attribute_option.deleted',
  // Category ↔ Group ve Product ↔ Group link event'leri (link tablosu hard
  // delete; assigned/unassigned ayrı event'ler raporlama için).
  'category_attributes.assigned',
  'category_attributes.unassigned',
  'product_attributes.assigned',
  'product_attributes.unassigned',
  'audit.purge',
]);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;
