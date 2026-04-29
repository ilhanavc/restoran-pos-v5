import { describe, expect, it, vi } from 'vitest';
import { z, ZodError } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { validateBody, validateParams, idParamSchema } from './validate';

function makeReq(overrides: Partial<Request> = {}): Request {
  return { body: {}, params: {}, query: {}, ...overrides } as Request;
}

function makeRes(): Response {
  return {} as Response;
}

describe('validateBody', () => {
  it('parses valid body and assigns coerced data', () => {
    const schema = z.object({ name: z.string(), n: z.coerce.number() });
    const mw = validateBody(schema);
    const req = makeReq({ body: { name: 'x', n: '7' } });
    const next = vi.fn();
    mw(req, makeRes(), next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]).toEqual([]);
    expect(req.body).toEqual({ name: 'x', n: 7 });
  });

  it('forwards ZodError to next on invalid body', () => {
    const schema = z.object({ name: z.string() });
    const mw = validateBody(schema);
    const req = makeReq({ body: { name: 42 } });
    const next = vi.fn();
    mw(req, makeRes(), next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(ZodError);
  });
});

describe('validateParams', () => {
  it('passes through valid UUID path param', () => {
    const mw = validateParams(idParamSchema);
    const req = makeReq({
      params: { id: '550e8400-e29b-41d4-a716-446655440000' },
    });
    const next = vi.fn();
    mw(req, makeRes(), next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]).toEqual([]);
    expect(req.params).toEqual({ id: '550e8400-e29b-41d4-a716-446655440000' });
  });

  it('forwards ZodError on malformed UUID (non-UUID string)', () => {
    const mw = validateParams(idParamSchema);
    const req = makeReq({ params: { id: 'not-a-uuid' } });
    const next = vi.fn();
    mw(req, makeRes(), next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(ZodError);
    const path = (err as ZodError).issues[0]?.path.join('.');
    expect(path).toBe('id');
  });

  it('forwards ZodError on UUID with wrong length', () => {
    const mw = validateParams(idParamSchema);
    const req = makeReq({ params: { id: '550e8400-e29b-41d4-a716' } });
    const next = vi.fn();
    mw(req, makeRes(), next as NextFunction);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(ZodError);
  });

  it('forwards ZodError on empty id', () => {
    const mw = validateParams(idParamSchema);
    const req = makeReq({ params: { id: '' } });
    const next = vi.fn();
    mw(req, makeRes(), next as NextFunction);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(ZodError);
  });

  it('extra params alongside id do not block (passthrough)', () => {
    const mw = validateParams(idParamSchema);
    const req = makeReq({
      params: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        other: 'kept-by-zod-strip',
      },
    });
    const next = vi.fn();
    mw(req, makeRes(), next as NextFunction);
    expect(next.mock.calls[0]).toEqual([]);
  });

  it('custom params schema works (e.g. id + sub-resource)', () => {
    const schema = z.object({
      id: z.string().uuid(),
      areaId: z.string().uuid(),
    });
    const mw = validateParams(schema);
    const req = makeReq({
      params: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        areaId: 'not-uuid',
      },
    });
    const next = vi.fn();
    mw(req, makeRes(), next as NextFunction);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(ZodError);
  });
});

describe('idParamSchema', () => {
  it('rejects uppercase UUID? (RFC 4122 case-insensitive — zod accepts both)', () => {
    const result = idParamSchema.safeParse({
      id: '550E8400-E29B-41D4-A716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects integer id', () => {
    const result = idParamSchema.safeParse({ id: '12345' });
    expect(result.success).toBe(false);
  });

  it('rejects undefined id', () => {
    const result = idParamSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
