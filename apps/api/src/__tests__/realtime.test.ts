import { type AddressInfo } from 'node:net';
import { createServer, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { type Socket as ClientSocket, io as ioClient } from 'socket.io-client';
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type IncomingCallEvent,
  SystemHelloPayloadSchema,
} from '@restoran-pos/shared-types';
import {
  createRealtimeServer,
  type RealtimeServer,
} from '../realtime/server.js';
import type { CallerStationLookup } from '../realtime/handshake.js';
import {
  emitIncomingCall,
  emitToRole,
  emitToTenant,
  emitToUser,
} from '../realtime/emit.js';

const ACCESS_SECRET = 'test-secret-min-32-chars-for-realtime-tests-xx';
const TENANT_A = '00000000-0000-7000-8000-000000000001';
const TENANT_B = '00000000-0000-7000-8000-000000000002';
const USER_ADMIN_A = '00000000-0000-7000-8000-000000000010';
const USER_WAITER_A = '00000000-0000-7000-8000-000000000011';
const USER_KITCHEN_A = '00000000-0000-7000-8000-000000000012';
const USER_ADMIN_B = '00000000-0000-7000-8000-000000000020';

type Role = 'admin' | 'cashier' | 'waiter' | 'kitchen';

interface SignParams {
  sub: string;
  tenantId: string;
  role: Role;
  /** Saniye cinsinden TTL (default 900 = 15 dk). Negatif → süresi dolmuş. */
  expiresInSec?: number;
}

// Handshake now verifies via the shared verifyAccessToken (HS256 pin + aud +
// iss + type:'access' + snake `tenant_id`), matching REST + the real signer
// (auth/jwt.ts). Test tokens must carry the same claims/options or they're
// rejected. `expiresInSec` is kept so the "expired token → reject" case still
// works (signAccessToken has a fixed TTL, so we mint inline here).
const TOKEN_AUDIENCE = 'restoran-pos-v5'; // = auth/jwt.ts AUDIENCE
const TOKEN_ISSUER = 'restoran-pos-v5-api'; // = auth/jwt.ts ISSUER

function signTestToken(p: SignParams): string {
  return jwt.sign(
    {
      sub: p.sub,
      tenant_id: p.tenantId,
      role: p.role,
      jti: randomUUID(),
      type: 'access',
    },
    ACCESS_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: p.expiresInSec ?? 900,
      audience: TOKEN_AUDIENCE,
      issuer: TOKEN_ISSUER,
    },
  );
}

interface FixtureBundle {
  httpServer: HttpServer;
  realtime: RealtimeServer;
  port: number;
}

async function startFixture(opts: {
  perUserLimit?: number;
  perTenantLimit?: number;
  callerStationLookup?: CallerStationLookup;
}): Promise<FixtureBundle> {
  const httpServer = createServer();
  const realtime = createRealtimeServer({
    httpServer,
    accessSecret: ACCESS_SECRET,
    webOrigin: 'http://localhost:5173',
    ...(opts.perUserLimit !== undefined && { perUserLimit: opts.perUserLimit }),
    ...(opts.perTenantLimit !== undefined && {
      perTenantLimit: opts.perTenantLimit,
    }),
    ...(opts.callerStationLookup !== undefined && {
      callerStationLookup: opts.callerStationLookup,
    }),
  });
  await new Promise<void>((res) => httpServer.listen(0, '127.0.0.1', () => res()));
  const address = httpServer.address() as AddressInfo;
  return { httpServer, realtime, port: address.port };
}

async function stopFixture(b: FixtureBundle): Promise<void> {
  await b.realtime.shutdown();
  await new Promise<void>((res) => b.httpServer.close(() => res()));
}

/**
 * `system.hello` server-side `connection` event'inden hemen sonra emit edilir;
 * `connect` ack'i ile aynı round-trip içinde gelir. Test tarafında listener'ı
 * `connect` resolve sonrasında register edersen RACE — emit kaçırılır.
 *
 * Çözüm: `autoConnect: false` ile socket aç, listener'ları KAYIT et, sonra
 * `connect()`. Hello promise socket'e attach edilir, test'ler `client.__hello`
 * ile bekler (immediate connect-time greeting'i tüketmek için).
 */
type ConnectedClient = ClientSocket & {
  readonly __hello: Promise<unknown>;
};

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

describe('Realtime Socket.IO server (Sprint 7 Görev 26)', () => {
  let main: FixtureBundle;

  beforeAll(async () => {
    main = await startFixture({ perUserLimit: 5, perTenantLimit: 50 });
  });

  // Test'ler arası counter izolasyonu — disconnect handler'ı server'a ulaşmadan
  // sonraki test connect ediyor, sahte limit aşımı oluyor. Reset zorunlu.
  beforeEach(() => {
    main.realtime.counters.perUser.clear();
    main.realtime.counters.perTenant.clear();
  });

  afterAll(async () => {
    await stopFixture(main);
  });

  describe('Auth handshake', () => {
    it('geçerli token → handshake success + system.hello + 3 oda', async () => {
      const token = signTestToken({
        sub: USER_ADMIN_A,
        tenantId: TENANT_A,
        role: 'admin',
      });
      const client = await connectClient(main.port, token);
      try {
        const hello = await client.__hello;
        const parsed = SystemHelloPayloadSchema.parse(hello);
        expect(parsed.user_id).toBe(USER_ADMIN_A);
        expect(parsed.tenant_id).toBe(TENANT_A);
        expect(parsed.role).toBe('admin');
        expect(parsed.rooms).toEqual([
          `tenant:${TENANT_A}`,
          `tenant:${TENANT_A}:role:admin`,
          `user:${USER_ADMIN_A}`,
        ]);
      } finally {
        client.disconnect();
      }
    });

    it('token yok → connect_error AUTH_TOKEN_MISSING', async () => {
      await expect(connectClient(main.port, undefined)).rejects.toMatchObject({
        message: 'error.realtime.auth.tokenMissing',
      });
    });

    it('geçersiz token → connect_error AUTH_TOKEN_INVALID', async () => {
      await expect(
        connectClient(main.port, 'not-a-real-jwt-token'),
      ).rejects.toMatchObject({
        message: 'error.realtime.auth.tokenInvalid',
      });
    });

    it('süresi dolmuş token → connect_error AUTH_TOKEN_INVALID', async () => {
      const expired = signTestToken({
        sub: USER_ADMIN_A,
        tenantId: TENANT_A,
        role: 'admin',
        expiresInSec: -1,
      });
      await expect(connectClient(main.port, expired)).rejects.toMatchObject({
        message: 'error.realtime.auth.tokenInvalid',
      });
    });
  });

  describe('Room scope + cross-tenant isolation', () => {
    it('emitToTenant: tenant A alır, tenant B ALMAZ (cross-tenant izolasyon)', async () => {
      const tokenA = signTestToken({
        sub: USER_ADMIN_A,
        tenantId: TENANT_A,
        role: 'admin',
      });
      const tokenB = signTestToken({
        sub: USER_ADMIN_B,
        tenantId: TENANT_B,
        role: 'admin',
      });
      const clientA = await connectClient(main.port, tokenA);
      const clientB = await connectClient(main.port, tokenB);
      try {
        await Promise.all([clientA.__hello, clientB.__hello]);

        const eventName = 'system.hello' as const;
        const payload = {
          event_id: '00000000-0000-7000-8000-000000000999',
          tenant_id: TENANT_A,
          emitted_at: new Date().toISOString(),
          user_id: USER_ADMIN_A,
          role: 'admin' as const,
          rooms: [`tenant:${TENANT_A}`],
        };

        let bReceived = false;
        clientB.on('system.hello', () => {
          bReceived = true;
        });
        const aReceived = new Promise<unknown>((resolve) => {
          clientA.once('system.hello', (p) => resolve(p));
        });

        emitToTenant(
          {
            io: main.realtime.io,
            eventName,
            payloadSchema: SystemHelloPayloadSchema,
          },
          TENANT_A,
          payload,
        );

        const got = await aReceived;
        expect(got).toMatchObject({ tenant_id: TENANT_A });
        // B'nin event almamış olmasını teyit için kısa bekleme
        await new Promise((r) => setTimeout(r, 100));
        expect(bReceived).toBe(false);
      } finally {
        clientA.disconnect();
        clientB.disconnect();
      }
    });

    it('emitToRole(waiter): waiter alır, kitchen ALMAZ (aynı tenant)', async () => {
      const tokenWaiter = signTestToken({
        sub: USER_WAITER_A,
        tenantId: TENANT_A,
        role: 'waiter',
      });
      const tokenKitchen = signTestToken({
        sub: USER_KITCHEN_A,
        tenantId: TENANT_A,
        role: 'kitchen',
      });
      const cw = await connectClient(main.port, tokenWaiter);
      const ck = await connectClient(main.port, tokenKitchen);
      try {
        await Promise.all([cw.__hello, ck.__hello]);

        let kitchenReceived = false;
        ck.on('system.hello', () => {
          kitchenReceived = true;
        });
        const waiterReceived = new Promise<unknown>((resolve) => {
          cw.once('system.hello', (p) => resolve(p));
        });

        emitToRole(
          {
            io: main.realtime.io,
            eventName: 'system.hello',
            payloadSchema: SystemHelloPayloadSchema,
          },
          TENANT_A,
          'waiter',
          {
            event_id: '00000000-0000-7000-8000-000000000998',
            tenant_id: TENANT_A,
            emitted_at: new Date().toISOString(),
            user_id: USER_WAITER_A,
            role: 'waiter',
            rooms: [`tenant:${TENANT_A}:role:waiter`],
          },
        );

        await waiterReceived;
        await new Promise((r) => setTimeout(r, 100));
        expect(kitchenReceived).toBe(false);
      } finally {
        cw.disconnect();
        ck.disconnect();
      }
    });

    it('emitToUser: yalnız hedef user alır', async () => {
      const tokenAdmin = signTestToken({
        sub: USER_ADMIN_A,
        tenantId: TENANT_A,
        role: 'admin',
      });
      const tokenWaiter = signTestToken({
        sub: USER_WAITER_A,
        tenantId: TENANT_A,
        role: 'waiter',
      });
      const ca = await connectClient(main.port, tokenAdmin);
      const cw = await connectClient(main.port, tokenWaiter);
      try {
        await Promise.all([ca.__hello, cw.__hello]);

        let waiterReceived = false;
        cw.on('system.hello', () => {
          waiterReceived = true;
        });
        const adminReceived = new Promise<unknown>((resolve) => {
          ca.once('system.hello', (p) => resolve(p));
        });

        emitToUser(
          {
            io: main.realtime.io,
            eventName: 'system.hello',
            payloadSchema: SystemHelloPayloadSchema,
          },
          USER_ADMIN_A,
          {
            event_id: '00000000-0000-7000-8000-000000000997',
            tenant_id: TENANT_A,
            emitted_at: new Date().toISOString(),
            user_id: USER_ADMIN_A,
            role: 'admin',
            rooms: [`user:${USER_ADMIN_A}`],
          },
        );

        await adminReceived;
        await new Promise((r) => setTimeout(r, 100));
        expect(waiterReceived).toBe(false);
      } finally {
        ca.disconnect();
        cw.disconnect();
      }
    });
  });

  describe('Ack pattern', () => {
    it('system.ping → ack ok:true + pong:true + server_time', async () => {
      const token = signTestToken({
        sub: USER_ADMIN_A,
        tenantId: TENANT_A,
        role: 'admin',
      });
      const client = await connectClient(main.port, token);
      try {
        await client.__hello;
        const ack = await new Promise<unknown>((resolve) => {
          client.emit('system.ping', (a: unknown) => resolve(a));
        });
        const ackSchema = z.object({
          ok: z.literal(true),
          data: z.object({
            pong: z.literal(true),
            server_time: z.string().datetime(),
          }),
        });
        expect(() => ackSchema.parse(ack)).not.toThrow();
      } finally {
        client.disconnect();
      }
    });

    it('disconnect sonrası counter cleanup (limit aşılmadan reconnect)', async () => {
      const token = signTestToken({
        sub: USER_ADMIN_A,
        tenantId: TENANT_A,
        role: 'admin',
      });
      // Aynı user 5 kere connect+disconnect — counter sıfırlanmalı, 6. başarılı
      for (let i = 0; i < 5; i++) {
        const c = await connectClient(main.port, token);
        c.disconnect();
        // Disconnect olayının server tarafına ulaşmasını bekle
        await new Promise((r) => setTimeout(r, 50));
      }
      const c6 = await connectClient(main.port, token);
      try {
        await c6.__hello;
        expect(c6.connected).toBe(true);
      } finally {
        c6.disconnect();
      }
    });
  });

  describe('Reconnect', () => {
    it('manuel disconnect → reconnect (yeni token) → yeniden hello', async () => {
      const token = signTestToken({
        sub: USER_ADMIN_A,
        tenantId: TENANT_A,
        role: 'admin',
      });
      const c1 = await connectClient(main.port, token);
      await c1.__hello;
      c1.disconnect();
      await new Promise((r) => setTimeout(r, 50));

      const tokenFresh = signTestToken({
        sub: USER_ADMIN_A,
        tenantId: TENANT_A,
        role: 'admin',
      });
      const c2 = await connectClient(main.port, tokenFresh);
      try {
        const hello = await c2.__hello;
        const parsed = SystemHelloPayloadSchema.parse(hello);
        expect(parsed.user_id).toBe(USER_ADMIN_A);
      } finally {
        c2.disconnect();
      }
    });
  });
});

describe('Realtime connection limits (ADR-010 §9)', () => {
  describe('per-user limit', () => {
    let bundle: FixtureBundle;

    beforeAll(async () => {
      bundle = await startFixture({ perUserLimit: 1, perTenantLimit: 50 });
    });

    afterAll(async () => {
      await stopFixture(bundle);
    });

    it('aynı user 2. handshake → connect_error CONN_LIMIT_USER', async () => {
      const token = signTestToken({
        sub: USER_ADMIN_A,
        tenantId: TENANT_A,
        role: 'admin',
      });
      const c1 = await connectClient(bundle.port, token);
      try {
        await expect(connectClient(bundle.port, token)).rejects.toMatchObject({
          message: 'error.realtime.connection.userLimit',
        });
      } finally {
        c1.disconnect();
      }
    });
  });

  describe('per-tenant limit', () => {
    let bundle: FixtureBundle;

    beforeAll(async () => {
      bundle = await startFixture({ perUserLimit: 5, perTenantLimit: 2 });
    });

    afterAll(async () => {
      await stopFixture(bundle);
    });

    it('tenant 3. handshake → connect_error CONN_LIMIT_TENANT', async () => {
      const t1 = signTestToken({
        sub: USER_ADMIN_A,
        tenantId: TENANT_A,
        role: 'admin',
      });
      const t2 = signTestToken({
        sub: USER_WAITER_A,
        tenantId: TENANT_A,
        role: 'waiter',
      });
      const t3 = signTestToken({
        sub: USER_KITCHEN_A,
        tenantId: TENANT_A,
        role: 'kitchen',
      });
      const c1 = await connectClient(bundle.port, t1);
      const c2 = await connectClient(bundle.port, t2);
      try {
        await expect(connectClient(bundle.port, t3)).rejects.toMatchObject({
          message: 'error.realtime.connection.tenantLimit',
        });
      } finally {
        c1.disconnect();
        c2.disconnect();
      }
    });
  });
});

/**
 * ADR-016 §11 caller-station odası — S86 canlı Caller ID denetimi regresyonları.
 *
 * S86'da popup 4 ayrı kırıkla ölüydü (#300 input offset, #301 io wiring,
 * #302 emit payload offset, #303 callerStationLookup bootstrap wiring). Bu blok
 * join→emit→receive zincirini + oda izolasyonunu + offset-payload sözleşmesini
 * kilitler. (index.ts bootstrap wiring'in kendisi unit-test edilemez — orada
 * güvence `caller_id.incoming.emitted` gözlem logu + bu round-trip.)
 */
describe('caller-station room (ADR-016 §11 — S86 regresyonları)', () => {
  const USER_CASHIER_A = '00000000-0000-7000-8000-000000000013';

  let fx: FixtureBundle;

  beforeAll(async () => {
    fx = await startFixture({
      perUserLimit: 5,
      perTenantLimit: 50,
      // Prod'daki tenant_settings lookup'ının saf muadili: TENANT_A'nın
      // istasyonu USER_CASHIER_A, diğer tenant'larda istasyon yok.
      callerStationLookup: (tenantId) =>
        Promise.resolve(tenantId === TENANT_A ? USER_CASHIER_A : null),
    });
  });

  beforeEach(() => {
    fx.realtime.counters.perUser.clear();
    fx.realtime.counters.perTenant.clear();
  });

  afterAll(async () => {
    await stopFixture(fx);
  });

  function sampleIncoming(): IncomingCallEvent {
    return {
      callLogId: randomUUID(),
      rawPhone: '05391234567',
      normalizedPhone: '05391234567',
      customer: null,
      receivedAt: new Date().toISOString(),
    };
  }

  const settle = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  it('istasyon kullanıcısı odaya join olur ve caller.incoming ALIR (join→emit→receive)', async () => {
    const station = await connectClient(
      fx.port,
      signTestToken({ sub: USER_CASHIER_A, tenantId: TENANT_A, role: 'cashier' }),
    );
    try {
      await station.__hello;
      // caller-station join'i handshake'te async lookup SONRASI (fire-and-forget
      // promise) — emit'ten önce settle şart.
      await settle(50);

      const payload = sampleIncoming();
      const received = new Promise<unknown>((resolve) => {
        station.once('caller.incoming', (p) => resolve(p));
      });
      emitIncomingCall(fx.realtime.io, TENANT_A, USER_CASHIER_A, payload);

      const evt = (await received) as IncomingCallEvent;
      expect(evt.callLogId).toBe(payload.callLogId);
      expect(evt.normalizedPhone).toBe('05391234567');
      expect(evt.customer).toBeNull();
    } finally {
      station.disconnect();
    }
  });

  it('istasyon OLMAYAN kullanıcı (aynı tenant) caller.incoming ALMAZ', async () => {
    const other = await connectClient(
      fx.port,
      signTestToken({ sub: USER_ADMIN_A, tenantId: TENANT_A, role: 'admin' }),
    );
    try {
      await other.__hello;
      await settle(50);

      let received = false;
      other.on('caller.incoming', () => {
        received = true;
      });
      emitIncomingCall(fx.realtime.io, TENANT_A, USER_CASHIER_A, sampleIncoming());

      await settle(150);
      expect(received).toBe(false);
    } finally {
      other.disconnect();
    }
  });

  it('emit payload offset receivedAt (.NET "O" +00:00) → throw (route Z-normalize etmek ZORUNDA — S86 #302)', () => {
    expect(() =>
      emitIncomingCall(fx.realtime.io, TENANT_A, USER_CASHIER_A, {
        ...sampleIncoming(),
        receivedAt: '2026-07-07T18:34:05.4310000+00:00',
      }),
    ).toThrow();
  });
});
