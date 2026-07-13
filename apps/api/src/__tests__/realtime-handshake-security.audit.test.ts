import { type AddressInfo } from 'node:net';
import { createServer, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { type Socket as ClientSocket, io as ioClient } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SystemHelloPayloadSchema } from '@restoran-pos/shared-types';
import {
  createRealtimeServer,
  type RealtimeServer,
} from '../realtime/server.js';
import { emitToRole } from '../realtime/emit.js';

/**
 * Deep-audit Blok 4 Hat C — Socket.IO handshake güvenlik derinleştirme.
 *
 * `realtime.test.ts` zaten token-yok / garbage-string / süresi-dolmuş vakalarını
 * kapsıyor (DEĞİŞTİRİLMEDİ). Bu dosya ADDITIVE: klasik JWT saldırı vektörlerini
 * (tampered signature, alg=none, yanlış secret) + `emitToRole` cross-tenant
 * matrisinde eksik bir hücreyi (aynı ROL, farklı TENANT) kapatır.
 *
 * Saf socket-katmanı testi — DB bağımlılığı YOK (JWT verify saf kriptografi,
 * `callerStationLookup` opsiyonel/geçilmiyor). `skipIf` gerekmez, her ortamda
 * çalışır.
 */

const ACCESS_SECRET = 'test-secret-min-32-chars-for-handshake-sec-tests';
const WRONG_SECRET = 'wrong-secret-min-32-chars-attacker-does-not-know';
const TENANT_A = '00000000-0000-7000-8000-0000000000a1';
const TENANT_B = '00000000-0000-7000-8000-0000000000b1';
const USER_ADMIN_A = '00000000-0000-7000-8000-0000000000a2';
const USER_ADMIN_B = '00000000-0000-7000-8000-0000000000b2';

const TOKEN_AUDIENCE = 'restoran-pos-v5';
const TOKEN_ISSUER = 'restoran-pos-v5-api';

function signValidToken(opts: {
  secret: string;
  sub: string;
  tenantId: string;
  role: string;
  expiresInSec?: number;
}): string {
  return jwt.sign(
    {
      sub: opts.sub,
      tenant_id: opts.tenantId,
      role: opts.role,
      jti: randomUUID(),
      type: 'access',
    },
    opts.secret,
    {
      algorithm: 'HS256',
      expiresIn: opts.expiresInSec ?? 900,
      audience: TOKEN_AUDIENCE,
      issuer: TOKEN_ISSUER,
    },
  );
}

function base64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/**
 * Klasik "alg=none" JWT sahteciliği: header'da alg='none', imza segmenti BOŞ.
 * Kütüphane (`jsonwebtoken`) ile değil, elle inşa edilir — gerçek saldırgan da
 * sunucunun signing kütüphanesine erişemez, yalnız token FORMATINI taklit eder.
 */
function craftAlgNoneToken(opts: {
  sub: string;
  tenantId: string;
  role: string;
}): string {
  const header = base64url({ alg: 'none', typ: 'JWT' });
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = base64url({
    sub: opts.sub,
    tenant_id: opts.tenantId,
    role: opts.role,
    jti: randomUUID(),
    type: 'access',
    aud: TOKEN_AUDIENCE,
    iss: TOKEN_ISSUER,
    iat: nowSec,
    exp: nowSec + 900,
  });
  return `${header}.${payload}.`;
}

/** Geçerli bir token alıp imza segmentini bozar (bit-flip simülasyonu). */
function tamperSignature(token: string): string {
  const parts = token.split('.');
  const sig = parts[2] ?? '';
  const flippedChar = sig.startsWith('A') ? 'B' : 'A';
  const flipped = sig.length > 0 ? flippedChar + sig.slice(1) : 'AAAA';
  return `${parts[0]}.${parts[1]}.${flipped}`;
}

interface FixtureBundle {
  httpServer: HttpServer;
  realtime: RealtimeServer;
  port: number;
}

async function startFixture(): Promise<FixtureBundle> {
  const httpServer = createServer();
  const realtime = createRealtimeServer({
    httpServer,
    accessSecret: ACCESS_SECRET,
    webOrigin: 'http://localhost:5173',
  });
  await new Promise<void>((res) => httpServer.listen(0, '127.0.0.1', () => res()));
  const address = httpServer.address() as AddressInfo;
  return { httpServer, realtime, port: address.port };
}

async function stopFixture(b: FixtureBundle): Promise<void> {
  await b.realtime.shutdown();
  await new Promise<void>((res) => b.httpServer.close(() => res()));
}

type ConnectedClient = ClientSocket & { readonly __hello: Promise<unknown> };

function connectClient(
  port: number,
  token: string | undefined,
): Promise<ConnectedClient> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${port}/realtime`, {
      auth: token === undefined ? {} : { token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      autoConnect: false,
    });
    let helloResolve!: (v: unknown) => void;
    const hello = new Promise<unknown>((res) => {
      helloResolve = res;
    });
    socket.once('system.hello', (p) => helloResolve(p));
    socket.once('connect', () => {
      Object.defineProperty(socket, '__hello', {
        value: hello,
        enumerable: false,
        configurable: false,
      });
      resolve(socket as ConnectedClient);
    });
    socket.once('connect_error', (err) => reject(err));
    socket.connect();
  });
}

describe('Socket.IO handshake — JWT sahtecilik vektörleri (Blok 4 Hat C)', () => {
  let fx: FixtureBundle;

  beforeAll(async () => {
    fx = await startFixture();
  });

  afterAll(async () => {
    await stopFixture(fx);
  });

  it('API-RT-AUDIT: imza kurcalanmış (tampered) token → connect_error AUTH_TOKEN_INVALID', async () => {
    const valid = signValidToken({
      secret: ACCESS_SECRET,
      sub: USER_ADMIN_A,
      tenantId: TENANT_A,
      role: 'admin',
    });
    const tampered = tamperSignature(valid);
    await expect(connectClient(fx.port, tampered)).rejects.toMatchObject({
      message: 'error.realtime.auth.tokenInvalid',
    });
  });

  it('API-RT-AUDIT: alg=none (imzasız, elle inşa edilmiş) token → connect_error AUTH_TOKEN_INVALID', async () => {
    const forged = craftAlgNoneToken({
      sub: USER_ADMIN_A,
      tenantId: TENANT_A,
      role: 'admin',
    });
    await expect(connectClient(fx.port, forged)).rejects.toMatchObject({
      message: 'error.realtime.auth.tokenInvalid',
    });
  });

  it('API-RT-AUDIT: yanlış secret ile imzalanmış token → connect_error AUTH_TOKEN_INVALID', async () => {
    const wrongSigned = signValidToken({
      secret: WRONG_SECRET,
      sub: USER_ADMIN_A,
      tenantId: TENANT_A,
      role: 'admin',
    });
    await expect(connectClient(fx.port, wrongSigned)).rejects.toMatchObject({
      message: 'error.realtime.auth.tokenInvalid',
    });
  });

  it('kontrol: doğru secret + geçerli claim → handshake başarılı (reddedilenlerin gerçekten reddedildiğini kanıtlar)', async () => {
    const valid = signValidToken({
      secret: ACCESS_SECRET,
      sub: USER_ADMIN_A,
      tenantId: TENANT_A,
      role: 'admin',
    });
    const client = await connectClient(fx.port, valid);
    try {
      const hello = await client.__hello;
      expect(SystemHelloPayloadSchema.safeParse(hello).success).toBe(true);
    } finally {
      client.disconnect();
    }
  });
});

describe('Room izolasyonu — emitToRole matris boşluğu doldurma (Blok 4 Hat C)', () => {
  let fx: FixtureBundle;

  beforeAll(async () => {
    fx = await startFixture();
  });

  beforeEach(() => {
    fx.realtime.counters.perUser.clear();
    fx.realtime.counters.perTenant.clear();
  });

  afterAll(async () => {
    await stopFixture(fx);
  });

  it('API-RT-AUDIT: emitToRole(admin, tenant A) → tenant B admin ALMAZ (aynı ROL, farklı TENANT)', async () => {
    const tokenAdminA = signValidToken({
      secret: ACCESS_SECRET,
      sub: USER_ADMIN_A,
      tenantId: TENANT_A,
      role: 'admin',
    });
    const tokenAdminB = signValidToken({
      secret: ACCESS_SECRET,
      sub: USER_ADMIN_B,
      tenantId: TENANT_B,
      role: 'admin',
    });
    const clientA = await connectClient(fx.port, tokenAdminA);
    const clientB = await connectClient(fx.port, tokenAdminB);
    try {
      await Promise.all([clientA.__hello, clientB.__hello]);

      let bReceived = false;
      clientB.on('system.hello', () => {
        bReceived = true;
      });
      const aReceived = new Promise<unknown>((resolve) => {
        clientA.once('system.hello', (p) => resolve(p));
      });

      emitToRole(
        {
          io: fx.realtime.io,
          eventName: 'system.hello',
          payloadSchema: SystemHelloPayloadSchema,
        },
        TENANT_A,
        'admin',
        {
          event_id: randomUUID(),
          tenant_id: TENANT_A,
          emitted_at: new Date().toISOString(),
          user_id: USER_ADMIN_A,
          role: 'admin',
          rooms: [`tenant:${TENANT_A}:role:admin`],
        },
      );

      await aReceived;
      await new Promise((r) => setTimeout(r, 100));
      expect(bReceived).toBe(false);
    } finally {
      clientA.disconnect();
      clientB.disconnect();
    }
  });
});
