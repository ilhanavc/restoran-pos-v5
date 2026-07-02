import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { RepositoryError } from '@restoran-pos/db';
import {
  AuthError,
  AUTH_MESSAGE_KEYS,
  domainError,
  toHttpError,
} from './errors.js';

describe('toHttpError', () => {
  it('AuthError → correct status and envelope', () => {
    const messageKey = AUTH_MESSAGE_KEYS['AUTH_TOKEN_INVALID'];
    if (messageKey === undefined) throw new Error('missing key');
    const err = new AuthError('AUTH_TOKEN_INVALID', messageKey, 401);
    const { status, body } = toHttpError(err);
    expect(status).toBe(401);
    expect(body.error.code).toBe('AUTH_TOKEN_INVALID');
    expect(body.error.message_key).toBe('error.auth.tokenInvalid');
  });

  it('RepositoryError unique → 409 RESOURCE_CONFLICT', () => {
    const { status, body } = toHttpError(new RepositoryError('unique'));
    expect(status).toBe(409);
    expect(body.error.code).toBe('RESOURCE_CONFLICT');
  });

  it('RepositoryError foreign_key TABLE_NOT_FOUND → 404 + code passthrough', () => {
    const { status, body } = toHttpError(
      new RepositoryError('foreign_key', 'TABLE_NOT_FOUND'),
    );
    expect(status).toBe(404);
    expect(body.error.code).toBe('TABLE_NOT_FOUND');
    expect(body.error.message_key).toBe('error.resource.table_not_found');
  });

  it('RepositoryError foreign_key CUSTOMER_NOT_FOUND → 409 + code passthrough', () => {
    const { status, body } = toHttpError(
      new RepositoryError('foreign_key', 'CUSTOMER_NOT_FOUND'),
    );
    expect(status).toBe(409);
    expect(body.error.code).toBe('CUSTOMER_NOT_FOUND');
    expect(body.error.message_key).toBe('error.resource.customer_not_found');
  });

  it('RepositoryError not_found → 404 RESOURCE_NOT_FOUND', () => {
    const { status, body } = toHttpError(new RepositoryError('not_found'));
    expect(status).toBe(404);
    expect(body.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('RepositoryError check with messageKey → pass-through', () => {
    const { status, body } = toHttpError(
      new RepositoryError('check', 'error.order.compOnClosed'),
    );
    expect(status).toBe(409);
    expect(body.error.code).toBe('ORDER_INVARIANT_VIOLATED');
    expect(body.error.message_key).toBe('error.order.compOnClosed');
  });

  it('ZodError → 400 VALIDATION_ERROR with fields', () => {
    const schema = z.object({ email: z.string().email() });
    const result = schema.safeParse({ email: 'bad' });
    if (result.success) throw new Error('expected failure');
    const { status, body } = toHttpError(result.error);
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toMatchObject({ fields: expect.any(Object) });
  });

  it('unknown error → 500 INTERNAL_ERROR', () => {
    const { status, body } = toHttpError(new Error('boom'));
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('domainError ORDER_NOT_FOUND → 404 + registry message_key (not error.internal)', () => {
    // Session 78 (task_7f45a99d) regresyon guard'ı: ORDER_NOT_FOUND registry'de
    // eksikti, ~19 sipariş 404'ü 'error.internal' message_key basıyordu.
    const { status, body } = toHttpError(domainError('ORDER_NOT_FOUND', 404));
    expect(status).toBe(404);
    expect(body.error.code).toBe('ORDER_NOT_FOUND');
    expect(body.error.message_key).toBe('error.order.notFound');
  });

  it('every domainError(CODE) literal in src is registered in AUTH_MESSAGE_KEYS', () => {
    // Session 78 (task_56cd16fe) — kalıcı registry-completeness guard'ı: kaynak
    // ağacındaki her `domainError('CODE'` literali AUTH_MESSAGE_KEYS'te olmalı,
    // aksi halde 'error.internal' fallback'ine düşer (ORDER_NOT_FOUND sınıfı bug).
    // Yeni bir kod eklenip registry'ye yazılmazsa bu test kırılır.
    const srcDir = fileURLToPath(new URL('.', import.meta.url));
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) out.push(...walk(p));
        else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
      }
      return out;
    };
    const re = /domainError\(\s*'([A-Z_]+)'/g;
    const missing = new Set<string>();
    for (const file of walk(srcDir)) {
      const content = readFileSync(file, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const code = m[1] as string;
        if (!(code in AUTH_MESSAGE_KEYS)) missing.add(code);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it('all static message_keys match error.<domain>.<camelCase> format', () => {
    // ADR-006: error.<domain>.<camelCase> — `error.internal` gibi tek-segment
    // generic anahtarlar da kabul (domain'e ait olmayan sistem hataları).
    const pattern = /^error\.[a-z][a-zA-Z]+(\.[a-z][a-zA-Z]+)*$/;
    for (const [code, key] of Object.entries(AUTH_MESSAGE_KEYS)) {
      expect(key, `${code} → ${key}`).toMatch(pattern);
    }
  });
});
