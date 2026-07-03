import { describe, it, expect } from 'vitest';
import { hasPermission, PERMISSIONS, type Action } from './permissions.js';
import type { UserRole } from './user.js';

/**
 * Explicit 4 roles × 27 actions = 108 assertions.
 * Source: ADR-002 §6 role permission matrix
 * (Sprint 6 Görev 24 amendment: `tenant.settings.read` admin + cashier;
 *  Sprint 12 PR-1 amendment 2026-05-08: `kds.itemStatusUpdate` added,
 *  `kds.read` narrowed to admin + kitchen — ADR-020 K7 / ADR-008 §4.2 rezerv kapanışı).
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
  'orders.move',
  'orders.merge',
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
  'print.bill',
  'tenant.settings',
  'tenant.settings.read',
  'audit.read',
  'caller.read',
  'caller.manage',
] as const;

type Matrix = Readonly<Record<UserRole, Readonly<Record<Action, boolean>>>>;

const MATRIX: Matrix = {
  admin: {
    'print.bill': true,
    'orders.create': true,
    'orders.update': true,
    'orders.cancel': true,
    'orders.comp': true,
    'orders.move': true,
    'orders.merge': true,
    'orders.read': true,
    'payments.create': true,
    'payments.refund': true,
    'tables.read': true,
    'tables.manage': true,
    'menu.manage': true,
    'menu.read': true,
    'menu.price.update': true,
    'users.manage': true,
    'users.password.change': true,
    'reports.run': true,
    'reports.read': true,
    'kds.read': true,
    'kds.itemStatusUpdate': true,
    'printer.settings': true,
    'tenant.settings': true,
    'tenant.settings.read': true,
    'audit.read': true,
    'caller.read': true,
    'caller.manage': true,
  },
  cashier: {
    'print.bill': true,
    'orders.create': true,
    'orders.update': true,
    'orders.cancel': true,
    'orders.comp': true,
    'orders.move': true,
    'orders.merge': true,
    'orders.read': true,
    'payments.create': true,
    'payments.refund': false,
    'tables.read': true,
    'tables.manage': false,
    'menu.manage': false,
    'menu.read': true,
    'menu.price.update': false,
    'users.manage': false,
    'users.password.change': true,
    'reports.run': false,
    'reports.read': true,
    'kds.read': false,
    'kds.itemStatusUpdate': false,
    'printer.settings': false,
    'tenant.settings': false,
    'tenant.settings.read': true,
    'audit.read': false,
    'caller.read': true,
    'caller.manage': false,
  },
  waiter: {
    'print.bill': true,
    'orders.create': true,
    'orders.update': true,
    'orders.cancel': false,
    'orders.comp': false,
    'orders.move': true, // ADR-028: garson masa taşıma (parasal-olmayan operasyonel aksiyon)
    'orders.merge': true, // ADR-029: garson adisyon birleştirme (orders.move aynası)
    'orders.read': true,
    'payments.create': true, // ADR-027 §7e: mobil operasyonel terminal — garson ödeme alır
    'payments.refund': false,
    'tables.read': true,
    'tables.manage': false,
    'menu.manage': false,
    'menu.read': true,
    'menu.price.update': false,
    'users.manage': false,
    'users.password.change': true,
    'reports.run': false,
    'reports.read': false,
    'kds.read': false,
    'kds.itemStatusUpdate': false,
    'printer.settings': false,
    'tenant.settings': false,
    'tenant.settings.read': false,
    'audit.read': false,
    'caller.read': false,
    'caller.manage': false,
  },
  kitchen: {
    'print.bill': false,
    'orders.create': false,
    'orders.update': false,
    'orders.cancel': false,
    'orders.comp': false,
    'orders.move': false,
    'orders.merge': false,
    'orders.read': true,
    'payments.create': false,
    'payments.refund': false,
    'tables.read': true,
    'tables.manage': false,
    'menu.manage': false,
    'menu.read': true,
    'menu.price.update': false,
    'users.manage': false,
    'users.password.change': true,
    'reports.run': false,
    'reports.read': false,
    'kds.read': true,
    'kds.itemStatusUpdate': true,
    'printer.settings': false,
    'tenant.settings': false,
    'tenant.settings.read': false,
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

  it('admin set has all 27 actions', () => {
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
