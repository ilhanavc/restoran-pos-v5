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
  | 'orders.read' // ABAC: waiter for own orders; kitchen for kitchen-routed items only
  | 'payments.create'
  | 'payments.refund'
  | 'tables.read'
  | 'tables.manage'
  | 'menu.manage'
  | 'menu.read'
  | 'menu.price.update'
  | 'users.manage'
  | 'users.password.change' // ABAC: non-admin only for self (req.user.sub === target.id)
  | 'reports.run'
  | 'reports.read'
  | 'kds.read' // ABAC: kitchen + admin only — cashier/waiter denied (ADR-020 K7, ADR-008 §4.2 rezerv kapanışı 2026-05-08)
  | 'kds.itemStatusUpdate' // ABAC: kitchen + admin only — Phase 3 KDS item status transitions (ADR-020 K7)
  | 'printer.settings'
  | 'tenant.settings' // PATCH semantic — admin only
  | 'tenant.settings.read' // GET semantic — admin + cashier (ADR-002 §6 amendment, Sprint 6 Görev 24)
  | 'audit.read'
  | 'caller.read'
  | 'caller.manage';

export type PermissionMap = Readonly<Record<Role, ReadonlySet<Action>>>;

export const PERMISSIONS: PermissionMap = {
  admin: new Set<Action>([
    'orders.create',
    'orders.update',
    'orders.cancel',
    'orders.comp',
    'orders.read',
    'payments.create',
    'payments.refund',
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
    'caller.manage',
  ]),
  cashier: new Set<Action>([
    'orders.create',
    'orders.update',
    'orders.cancel',
    'orders.comp',
    'orders.read',
    'payments.create',
    'tables.read',
    'menu.read',
    'users.password.change',
    'reports.read',
    'caller.read',
    'tenant.settings.read',
  ]),
  waiter: new Set<Action>([
    'orders.create',
    'orders.update', // ABAC: only own orders
    'orders.read', // ABAC: only own orders
    'payments.create', // ADR-027 §7e: mobil operasyonel terminal — garson ödeme alır (refund/comp/iptal HARİÇ)
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
