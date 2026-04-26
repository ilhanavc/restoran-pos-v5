import { describe, it, expect } from 'vitest';
import { hasPermission, PERMISSIONS, type Action } from './permissions.js';
import type { UserRole } from './user.js';

/**
 * Explicit 4 roles × 21 actions = 84 assertions.
 * Source: ADR-002 §6 role permission matrix.
 *
 * ABAC refinements (e.g. "waiter can only read own orders") are
 * enforced in the route handler — at the RBAC level, the permission
 * is granted (true) and the handler narrows the scope.
 */

const ALL_ACTIONS: readonly Action[] = [
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
] as const;

type Matrix = Readonly<Record<UserRole, Readonly<Record<Action, boolean>>>>;

const MATRIX: Matrix = {
  admin: {
    'orders.create': true,
    'orders.update': true,
    'orders.cancel': true,
    'orders.comp': true,
    'orders.read': true,
    'payments.create': true,
    'payments.refund': true,
    'tables.read': true,
    'tables.manage': true,
    'menu.manage': true,
    'menu.price.update': true,
    'users.manage': true,
    'users.password.change': true,
    'reports.run': true,
    'reports.read': true,
    'kds.read': true,
    'printer.settings': true,
    'tenant.settings': true,
    'audit.read': true,
    'caller.read': true,
    'caller.manage': true,
  },
  cashier: {
    'orders.create': true,
    'orders.update': true,
    'orders.cancel': true,
    'orders.comp': true,
    'orders.read': true,
    'payments.create': true,
    'payments.refund': false,
    'tables.read': true,
    'tables.manage': false,
    'menu.manage': false,
    'menu.price.update': false,
    'users.manage': false,
    'users.password.change': true,
    'reports.run': false,
    'reports.read': true,
    'kds.read': true,
    'printer.settings': false,
    'tenant.settings': false,
    'audit.read': false,
    'caller.read': true,
    'caller.manage': false,
  },
  waiter: {
    'orders.create': true,
    'orders.update': true,
    'orders.cancel': false,
    'orders.comp': false,
    'orders.read': true,
    'payments.create': false,
    'payments.refund': false,
    'tables.read': true,
    'tables.manage': false,
    'menu.manage': false,
    'menu.price.update': false,
    'users.manage': false,
    'users.password.change': true,
    'reports.run': false,
    'reports.read': false,
    'kds.read': true,
    'printer.settings': false,
    'tenant.settings': false,
    'audit.read': false,
    'caller.read': false,
    'caller.manage': false,
  },
  kitchen: {
    'orders.create': false,
    'orders.update': false,
    'orders.cancel': false,
    'orders.comp': false,
    'orders.read': true,
    'payments.create': false,
    'payments.refund': false,
    'tables.read': true,
    'tables.manage': false,
    'menu.manage': false,
    'menu.price.update': false,
    'users.manage': false,
    'users.password.change': true,
    'reports.run': false,
    'reports.read': false,
    'kds.read': true,
    'printer.settings': false,
    'tenant.settings': false,
    'audit.read': false,
    'caller.read': false,
    'caller.manage': false,
  },
};

const ROLES: readonly UserRole[] = ['admin', 'cashier', 'waiter', 'kitchen'];

describe('PERMISSIONS map shape', () => {
  it('contains all four roles', () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual([...ROLES].sort());
  });

  it('admin set has all 21 actions', () => {
    expect(PERMISSIONS.admin.size).toBe(ALL_ACTIONS.length);
  });
});

for (const role of ROLES) {
  describe(`hasPermission(${role}, …)`, () => {
    for (const action of ALL_ACTIONS) {
      const expected = MATRIX[role][action];
      it(`${action} → ${expected}`, () => {
        expect(hasPermission(role, action)).toBe(expected);
      });
    }
  });
}
