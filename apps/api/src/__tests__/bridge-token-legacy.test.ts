import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { requireLegacyBridgeTenant } from '../middleware/bridge-token.js';

// ADR-052 K5.1 — unit coverage for the legacy-token tenant lock (no DB).
const LIVE = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';

function run(locked: string | undefined, headerTenant: string) {
  const req = { tenantId: headerTenant } as unknown as Request;
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  requireLegacyBridgeTenant(locked)(req, res, next);
  return { req, status, json, next };
}

describe('requireLegacyBridgeTenant (ADR-052 K5.1)', () => {
  it('canlı tenant → next, req.tenantId küçük harfe normalize', () => {
    const r = run(LIVE, LIVE.toUpperCase());
    expect(r.next).toHaveBeenCalledOnce();
    expect(r.status).not.toHaveBeenCalled();
    expect(r.req.tenantId).toBe(LIVE);
  });

  it('başka tenant → 401 BRIDGE_TOKEN_INVALID, next YOK', () => {
    const r = run(LIVE, OTHER);
    expect(r.next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(401);
    expect(r.json).toHaveBeenCalledWith({ error: { code: 'BRIDGE_TOKEN_INVALID' } });
  });

  it.each([undefined, ''])('kilit tenant tanımsız/boş (%s) → her istek 401 (fail-closed)', (locked) => {
    const r = run(locked, LIVE);
    expect(r.next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(401);
  });
});
