import { describe, expect, it } from 'vitest';
import { hasPermission } from './permissions.js';

/**
 * Blok 2 denetim bulgusu SD-T-B-03 — KASITLI KIRMIZI karakterizasyon.
 *
 * permissions.ts:123-125 `PERMISSIONS[role].has(action)` — tanımsız bir rol
 * gelirse `PERMISSIONS[role]` undefined olur ve `.has` çağrısı TypeError
 * fırlatır. Docstring'in ima ettiği "default-deny" davranışı (bilinmeyen →
 * false) tutmuyor; JWT'den beklenmedik bir rol sızarsa 403 yerine 500 üretir.
 *
 * Beklenen: bilinmeyen rol → sessizce false (default-deny).
 * Bugün: TypeError → bu test fix'e kadar KIRMIZI kalır.
 */
describe('hasPermission bilinmeyen rol default-deny (SD-T-B-03)', () => {
  it('SD-T-B-03 tanımsız rol için throw etmeden false dönmeli (bugün: TypeError)', () => {
    const unknownRole = 'superadmin' as Parameters<typeof hasPermission>[0];
    expect(hasPermission(unknownRole, 'orders.read')).toBe(false);
  });
});
