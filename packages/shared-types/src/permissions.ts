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
  | 'menu.price.update'
  | 'users.manage'
  | 'users.password.change' // ABAC: non-admin only for self (req.user.sub === target.id)
  | 'reports.run'
  | 'reports.read'
  | 'kds.read'
  | 'printer.settings'
  | 'tenant.settings'
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
    'menu.price.update',
    'users.manage',
    'users.password.change',
    'reports.run',
    'reports.read',
    'kds.read',
    'printer.settings',
    'tenant.settings',
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
    'users.password.change',
    'reports.read',
    'kds.read',
    'caller.read',
  ]),
  waiter: new Set<Action>([
    'orders.create',
    'orders.update', // ABAC: only own orders
    'orders.read', // ABAC: only own orders
    'tables.read',
    'users.password.change',
    'kds.read',
  ]),
  kitchen: new Set<Action>([
    'orders.read', // ABAC: only kitchen-routed items
    'tables.read',
    'users.password.change',
    'kds.read',
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
