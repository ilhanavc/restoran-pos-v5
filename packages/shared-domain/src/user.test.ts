import { describe, it, expect } from 'vitest';
import type { UserRole } from '@restoran-pos/shared-types';
import {
  validatePassword,
  canManageUsers,
  canHardDeleteUser,
} from './user.js';

describe('validatePassword', () => {
  it('rejects an empty string as empty', () => {
    expect(validatePassword('')).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects pure whitespace as empty (trim semantics)', () => {
    expect(validatePassword('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(validatePassword('\t\n  ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects 9-character password as too_short', () => {
    expect(validatePassword('abcde1234')).toEqual({
      ok: false,
      reason: 'too_short',
    });
  });

  it('accepts exactly 10 characters as the minimum boundary', () => {
    expect(validatePassword('abcde12345')).toEqual({ ok: true });
  });

  it('accepts long passwords (no upper bound)', () => {
    expect(validatePassword('a'.repeat(100))).toEqual({ ok: true });
  });

  it('accepts non-trimmed length: leading/trailing whitespace counts (NIST 800-63B)', () => {
    // 8 visible chars + 2 leading spaces = 10 raw length → accepted
    expect(validatePassword('  abcdefgh')).toEqual({ ok: true });
  });

  it('does NOT enforce complexity rules (no uppercase/digit/symbol requirement)', () => {
    expect(validatePassword('aaaaaaaaaa')).toEqual({ ok: true });
    expect(validatePassword('1234567890')).toEqual({ ok: true });
  });

  it('returns the exact reason literals on the blocked branches (typo regression guard)', () => {
    const empty = validatePassword('');
    const tooShort = validatePassword('short');
    if (empty.ok || tooShort.ok) {
      throw new Error('expected both to be blocked');
    }
    expect(empty.reason).toBe('empty');
    expect(tooShort.reason).toBe('too_short');
  });

  it('checks empty BEFORE too_short (whitespace shorter than 10 is empty, not too_short)', () => {
    // 5 whitespace chars: trim().length === 0 → empty (not too_short)
    expect(validatePassword('     ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('is a pure function: identical input yields identical output across calls', () => {
    const a = validatePassword('abcde12345');
    const b = validatePassword('abcde12345');
    const c = validatePassword('abcde12345');
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a).toEqual({ ok: true });
  });
});

describe('canManageUsers', () => {
  it('allows admin to manage users', () => {
    expect(canManageUsers('admin')).toEqual({ ok: true });
  });

  it('blocks cashier from managing users', () => {
    expect(canManageUsers('cashier')).toEqual({
      ok: false,
      reason: 'insufficient_role',
    });
  });

  it('blocks waiter from managing users', () => {
    expect(canManageUsers('waiter')).toEqual({
      ok: false,
      reason: 'insufficient_role',
    });
  });

  it('blocks kitchen from managing users', () => {
    expect(canManageUsers('kitchen')).toEqual({
      ok: false,
      reason: 'insufficient_role',
    });
  });

  it('returns the exact reason literal on the blocked branch (typo regression guard)', () => {
    const result = canManageUsers('waiter');
    if (result.ok) {
      throw new Error('expected blocked result');
    }
    expect(result.reason).toBe('insufficient_role');
  });

  it('covers every UserRole enum member exhaustively', () => {
    // If a new role is ever added to UserRole, this test must be updated;
    // TypeScript exhaustiveness check below also forces awareness.
    const roles: UserRole[] = ['admin', 'cashier', 'waiter', 'kitchen'];
    const results = roles.map((r) => ({ role: r, ok: canManageUsers(r).ok }));
    expect(results).toEqual([
      { role: 'admin', ok: true },
      { role: 'cashier', ok: false },
      { role: 'waiter', ok: false },
      { role: 'kitchen', ok: false },
    ]);
  });
});

describe('canHardDeleteUser', () => {
  it('allows hard-delete when user has no referencing records', () => {
    expect(canHardDeleteUser({ hasReferencingRecords: false })).toEqual({
      ok: true,
    });
  });

  it('blocks hard-delete when user is referenced by records', () => {
    expect(canHardDeleteUser({ hasReferencingRecords: true })).toEqual({
      ok: false,
      reason: 'user_referenced_by_records',
    });
  });

  it('returns the exact reason literal on the blocked branch (typo regression guard)', () => {
    const result = canHardDeleteUser({ hasReferencingRecords: true });
    if (result.ok) {
      throw new Error('expected blocked result');
    }
    expect(result.reason).toBe('user_referenced_by_records');
  });

  it('is a pure function: identical input yields identical output across calls', () => {
    const input = { hasReferencingRecords: true } as const;
    const a = canHardDeleteUser(input);
    const b = canHardDeleteUser(input);
    expect(a).toEqual(b);
    expect(a).toEqual({
      ok: false,
      reason: 'user_referenced_by_records',
    });
  });
});
