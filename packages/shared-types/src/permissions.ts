import type { UserRole } from './user.js';

/**
 * Role-based access control matrix per ADR-002 §6.
 *
 * Pure type module — no HTTP/DB imports, no side effects.
 * Default-deny: any role/action pair not explicitly listed is denied.
 *
 * ABAC (Attribute-Based Access Control) refinements happen in route
 * handlers AFTER this RBAC check passes. ABAC notes are documented
 * inline as comments next to relevant actions.
 */

type Role = UserRole;

export type Action =
  | 'orders.create'
  | 'orders.update' // ABAC: waiter only for own orders (req.user.sub === order.created_by)
  | 'orders.cancel'
  | 'orders.comp'
  | 'orders.move' // ADR-028: aktif dine_in siparişi boş masaya taşı (admin/cashier/waiter; kitchen HARİÇ)
  | 'orders.merge' // ADR-029: dolu masanın adisyonunu başka DOLU masaya aktar/merge (admin/cashier/waiter; kitchen HARİÇ)
  | 'orders.read' // ABAC: waiter for own orders; kitchen for kitchen-routed items only
  | 'payments.create'
  // payments.refund: v5.1 — route HENÜZ YOK (errors.ts:148 kod tanımlı, endpoint
  // yok). Matris-anchor olarak korunur; hiçbir aktif route buna map DEĞİLDİR.
  // refund = idari para-iade (kapanmış iş-günü / farklı gün) — void'den ayrı.
  | 'payments.refund'
  // payments.void: ADR-033 K6 — aynı-gün operasyonel ödeme düzeltmesi (yanlış tutar/
  // yöntem geri-al → adisyon reopen). POST /payments/:paymentId/void. admin + cashier;
  // waiter/kitchen HARİÇ. refund'dan KASITLI asimetri: void = aynı-gün düzeltme
  // (kasiyer kendi hatasını anında düzeltir), refund = idari para-iade (v5.1).
  | 'payments.void'
  | 'tables.read'
  | 'tables.manage'
  | 'menu.manage'
  | 'menu.read'
  | 'menu.price.update'
  | 'users.manage'
  | 'users.password.change' // ABAC: non-admin only for self (req.user.sub === target.id)
  // reports.run: v5.1 "ağır rapor" (async üretim / export) rezervi — hiçbir route buna
  // map DEĞİLDİR. Tüm aktif GET rapor endpoint'i (reports/*) reports.read'e map olur
  // (admin + cashier). ADR-002 §6 anchor'ı olarak korunur (ADR-034 B2).
  | 'reports.run'
  | 'reports.read'
  | 'kds.read' // ABAC: kitchen + admin only — cashier/waiter denied (ADR-020 K7, ADR-008 §4.2 rezerv kapanışı 2026-05-08)
  | 'kds.itemStatusUpdate' // ABAC: kitchen + admin only — Phase 3 KDS item status transitions (ADR-020 K7)
  | 'printer.settings'
  | 'print.bill' // ADR-027 §7e: on-demand adisyon baskısı (admin/cashier/waiter; kitchen HARİÇ)
  | 'tenant.settings' // PATCH semantic — admin only
  | 'tenant.settings.read' // GET semantic — admin + cashier (ADR-002 §6 amendment, Sprint 6 Görev 24)
  | 'audit.read'
  | 'caller.read'
  // caller.log.update: ADR-016 §11 — operatör telefon-popup aksiyonu (çağrıyı kapat /
  // gelen siparişe bağla). PATCH /caller-id/logs/:id/status buna map olur. admin +
  // cashier (telefonu yanıtlayan operatör). ADR-034 Drift-3a: KORU.
  | 'caller.log.update'
  // caller.manage: gelecek istasyon/hat YAPILANDIRMA endpoint'i için REZERVE; admin.
  // Hiçbir mevcut route buna map DEĞİLDİR — operatör popup aksiyonu caller.log.update'e
  // ayrıldı (yapılandırma ≠ operasyonel aksiyon).
  | 'caller.manage';

export type PermissionMap = Readonly<Record<Role, ReadonlySet<Action>>>;

export const PERMISSIONS: PermissionMap = {
  admin: new Set<Action>([
    'orders.create',
    'orders.update',
    'orders.cancel',
    'orders.comp',
    'orders.move',
    'orders.merge',
    'orders.read',
    'payments.create',
    'payments.refund',
    'payments.void',
    'print.bill',
    'tables.read',
    'tables.manage',
    'menu.manage',
    'menu.read',
    'menu.price.update',
    'users.manage',
    'users.password.change',
    'reports.run',
    'reports.read',
    'kds.read',
    'kds.itemStatusUpdate',
    'printer.settings',
    'tenant.settings',
    'tenant.settings.read',
    'audit.read',
    'caller.read',
    'caller.log.update',
    'caller.manage',
  ]),
  cashier: new Set<Action>([
    'orders.create',
    'orders.update',
    // ADR-034 B2 (2026-07-12): 'orders.cancel' KALDIRILDI — POST /orders/:id/cancel
    // KASITLI admin-only (orders.ts:817 "parasal/operasyonel etki"). Matris bayat
    // idi (parite testi yüzeye çıkardı); route kaynak-doğru → matris hizalandı.
    'orders.comp', // ABAC: item-toggle (orders.update route) + inline; cashier izinli
    'orders.move',
    'orders.merge',
    'orders.read',
    'payments.create',
    'payments.void', // ADR-033 K6 / ADR-034 Drift-2a: aynı-gün ödeme düzeltmesi
    'print.bill',
    'tables.read',
    'menu.read',
    'users.password.change',
    'reports.read',
    'caller.read',
    'caller.log.update', // ADR-016 §11 / ADR-034 Drift-3a: operatör popup aksiyonu
    'tenant.settings.read',
  ]),
  waiter: new Set<Action>([
    'orders.create',
    'orders.update', // ABAC: only own orders
    'orders.move', // ADR-028: masa taşıma parasal-olmayan operasyonel aksiyon (ADR-008 §7e)
    'orders.merge', // ADR-029: adisyon birleştirme parasal-olmayan operasyonel aksiyon (ADR-008 §7e)
    'orders.read', // ABAC: only own orders
    'payments.create', // ADR-027 §7e: mobil operasyonel terminal — garson ödeme alır (refund/comp/iptal HARİÇ)
    'print.bill', // ADR-027 §7e: on-demand adisyon baskısı
    'tables.read',
    'menu.read',
    'users.password.change',
  ]),
  kitchen: new Set<Action>([
    'orders.read', // ABAC: only kitchen-routed items
    'tables.read',
    'menu.read',
    'users.password.change',
    'kds.read',
    'kds.itemStatusUpdate',
  ]),
};

/**
 * RBAC check: does the given role grant the action?
 *
 * Returns true when the role/action pair is allowed by the matrix.
 * ABAC ownership/scoping is enforced separately in the route handler
 * after this check passes.
 */
export function hasPermission(role: Role, action: Action): boolean {
  return PERMISSIONS[role].has(action);
}
