import { describe, it, expect } from 'vitest';
import { canHardDeleteProduct } from './menu.js';

describe('canHardDeleteProduct', () => {
  it('allows hard-delete when product has no referencing order_items', () => {
    const result = canHardDeleteProduct({ hasReferencingOrderItems: false });
    expect(result).toEqual({ ok: true });
  });

  it('blocks hard-delete when product is referenced by order_items', () => {
    const result = canHardDeleteProduct({ hasReferencingOrderItems: true });
    expect(result).toEqual({
      ok: false,
      reason: 'product_referenced_by_order_items',
    });
  });

  it('returns the exact reason literal on the blocked branch (typo regression guard)', () => {
    const result = canHardDeleteProduct({ hasReferencingOrderItems: true });
    if (result.ok) {
      throw new Error('expected blocked result');
    }
    // String literal is the contract surface; any drift breaks callers.
    expect(result.reason).toBe('product_referenced_by_order_items');
  });

  it('narrows the discriminated union: reason is unreachable when ok === true', () => {
    const result = canHardDeleteProduct({ hasReferencingOrderItems: false });
    // Type-level assertion: in the `ok: true` branch, `reason` is not part of
    // the type and TypeScript would reject `result.reason` at compile time.
    // This `it` exists so the contract is documented next to the runtime tests;
    // the compiler enforces the actual narrowing during `pnpm typecheck`.
    expect(result.ok).toBe(true);
    if (result.ok) {
      // @ts-expect-error reason does not exist on the ok-true branch
      const _shouldNotCompile: unknown = result.reason;
      void _shouldNotCompile;
    }
  });

  it('is a pure function: identical input yields identical output across calls', () => {
    const input = { hasReferencingOrderItems: true } as const;
    const a = canHardDeleteProduct(input);
    const b = canHardDeleteProduct(input);
    const c = canHardDeleteProduct(input);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a).toEqual({
      ok: false,
      reason: 'product_referenced_by_order_items',
    });
  });
});
