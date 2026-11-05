import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { safeErrSerializer } from '../logger.js';
import { errorHandler } from './errorHandler.js';
import { mount } from './mount.js';

/**
 * docs/audit/23514-teshis-2026-09-27.md §3 F1 — 5xx log satırı teşhis edilebilir
 * olmalı. Testler log'a BASILAN objeyi doğrular: route/method/kimlik + pg
 * `constraint` görünür, pg `detail`'indeki satır DEĞERLERİ (telefon/e-posta)
 * görünmez.
 *
 * Hata gerçek bir Express app üzerinden `next(err)` ile geçirilir — `req.route`
 * şablonunun gerçekten dolduğunu taklit değil Express'in kendi davranışı
 * kanıtlasın diye (transport katmanını atlayan test bu sınıfı göstermez).
 */

const { errorSpy } = vi.hoisted(() => ({
  errorSpy: vi.fn<(payload: Record<string, unknown>, msg: string) => void>(),
}));

vi.mock('../logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../logger.js')>();
  return { ...actual, logger: { error: errorSpy } };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ORDER_PATH = '/orders/7c9e6679-7425-40de-944b-e07fc1f90ae7/items';

/**
 * node-pg `DatabaseError` şekli. `severity` + `routine` protokolün ErrorResponse
 * alanlarıdır ('S' / 'R') ve sürücü daima doldurur — `describePgError` pg
 * hatasını Node hata kodlarından (EPIPE vb.) bu alanlarla ayırır.
 */
function pgError(message: string, fields: Record<string, string>): Error {
  return Object.assign(new Error(message), {
    severity: 'ERROR',
    routine: 'ExecConstraints',
    ...fields,
  });
}

/**
 * `/orders/:orderId/items` altında verilen hatayı fırlatan app.
 *
 * `mount()` kullanır — gerçek `app.ts` ile aynı yol. Doğrudan
 * `app.use(path, router)` yazılsaydı `mountPattern` boş kalır ve log satırı
 * öneksiz basardı; yani bu harness'ın kendisi de amendment'ın kapsamına dahil.
 */
function buildApp(err: unknown): express.Express {
  const app = express();
  const router = express.Router();
  router.post('/:orderId/items', (req, _res, next) => {
    req.user = { userId: USER_ID, tenantId: TENANT_ID, role: 'cashier' };
    next(err);
  });
  mount(app, '/orders', router);
  app.use(errorHandler);
  return app;
}

/**
 * T1'in riskli vakası: **parametreli** mount deseni
 * (`/products/:id/attribute-groups`, ADR-012). `req.baseUrl` okunsaydı burada
 * log'a gerçek ürün UUID'si girerdi; desen taşındığı için `:id` girer.
 */
const PRODUCT_ID = 'a3f1c8e2-4b7d-4e91-8c22-9f5e1d0a7b64';
const PARAM_MOUNT = '/products/:id/attribute-groups';

function buildParamMountApp(err: unknown): express.Express {
  const app = express();
  const router = express.Router({ mergeParams: true });
  router.delete('/:groupId', (req, _res, next) => {
    req.user = { userId: USER_ID, tenantId: TENANT_ID, role: 'admin' };
    next(err);
  });
  mount(app, PARAM_MOUNT, router);
  app.use(errorHandler);
  return app;
}

function loggedPayload(): Record<string, unknown> {
  const call = errorSpy.mock.calls[0];
  if (call === undefined) throw new Error('logger.error çağrılmadı');
  return call[0];
}

describe('errorHandler — teşhis log payload (F1)', () => {
  beforeEach(() => {
    errorSpy.mockClear();
  });

  it('ham pg 23514 → log satırında constraint + table + route + kimlik var', async () => {
    const err = pgError(
      'new row for relation "order_items" violates check constraint "order_items_qty_positive"',
      {
        code: '23514',
        constraint: 'order_items_qty_positive',
        table: 'order_items',
        schema: 'public',
      },
    );

    const res = await request(buildApp(err)).post(ORDER_PATH).send({});

    // ADR-006 kontratı değişmedi: map'lenmemiş pg hatası 500 INTERNAL_ERROR.
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');

    expect(loggedPayload()).toMatchObject({
      method: 'POST',
      // TAM şablon: önek `req.mountPattern`'dan gelir (ADR-006 §2 Amendment
      // 2026-11-05). Bu satır eskiden `/:orderId/items` idi — `req.baseUrl`
      // app seviyesinde boşaldığı için önek kayıptı.
      route: '/orders/:orderId/items',
      tenantId: TENANT_ID,
      userId: USER_ID,
      pg: {
        code: '23514',
        constraint: 'order_items_qty_positive',
        table: 'order_items',
      },
    });
  });

  it('23514 detail\'i İHLAL EDEN SATIRI taşır → detail hiç basılmaz (KVKK)', async () => {
    // PG 23514/23502'de detail formatı `Failing row contains (…)` — satırın
    // TAMAMI. `Key (kolon)=(değer)` sanitize'ı bu formatı tanımaz; güvence
    // regex'in eşleşmemesine değil SQLSTATE allowlist'ine dayanmalı.
    const phone = '05551234567';
    const err = pgError(
      'new row for relation "customers" violates check constraint "customers_phone_format"',
      {
        code: '23514',
        constraint: 'customers_phone_format',
        table: 'customers',
        detail: `Failing row contains (3, ${phone}, Ahmet Yılmaz, Atatürk Cad. 5).`,
      },
    );

    const res = await request(buildApp(err)).post(ORDER_PATH).send({});
    expect(res.status).toBe(500);

    const payload = loggedPayload();
    expect(payload['pg']).toMatchObject({ constraint: 'customers_phone_format' });
    expect(payload['pg']).not.toHaveProperty('detail');

    const { err: raw, ...addedFields } = payload;
    expect(JSON.stringify(addedFields)).not.toContain(phone);
    expect(JSON.stringify(addedFields)).not.toContain('Ahmet');
    expect(JSON.stringify(safeErrSerializer(raw))).not.toContain(phone);
  });

  it('23514 + `Key (…)=(…)` biçimli detail bile basılmaz — kilit SQLSTATE\'te', async () => {
    // Yukarıdaki test tek başına allowlist'i KİLİTLEMEZ: `Failing row contains`
    // zaten sanitize regex'ine uymadığı için allowlist kaldırılsa da yeşil
    // kalırdı. Bu vaka `detail`'i regex'in EŞLEŞECEĞİ biçimde verir — artık
    // yalnız SQLSTATE kapısı tutuyor (PG 23514'te bu biçimi üretmez; kontrat
    // testi: `detail` yalnız 23505/23503/23P01'de okunur).
    const phone = '05551234567';
    const err = pgError('check violation', {
      code: '23514',
      constraint: 'customers_phone_format',
      detail: `Key (phone)=(${phone}) already exists.`,
    });

    const res = await request(buildApp(err)).post(ORDER_PATH).send({});
    expect(res.status).toBe(500);
    expect(loggedPayload()['pg']).not.toHaveProperty('detail');
  });

  it('pg 23505 detail\'i satır değeri taşıyorsa log yalnız KOLON ADINI basar (KVKK)', async () => {
    const phone = '05551234567';
    const err = pgError(
      'duplicate key value violates unique constraint "customer_phones_phone_key"',
      {
        code: '23505',
        constraint: 'customer_phones_phone_key',
        table: 'customer_phones',
        detail: `Key (phone)=(${phone}) already exists.`,
      },
    );

    const res = await request(buildApp(err)).post(ORDER_PATH).send({});
    expect(res.status).toBe(500);

    const payload = loggedPayload();
    expect(payload['pg']).toMatchObject({ detail: 'phone' });

    // errorHandler'ın KENDİ eklediği alanlar: ham değer hiçbirinde yok.
    const { err: raw, ...addedFields } = payload;
    expect(JSON.stringify(addedFields)).not.toContain(phone);

    // Ham hata objesi pino'ya `err` olarak gider; gerçek boru hattında
    // `safeErrSerializer` onu name/code'a indirger — ham `detail` log'a
    // ULAŞMAZ. Garantiyi serializer'ın kendisine karşı sına.
    expect(JSON.stringify(safeErrSerializer(raw))).not.toContain(phone);
  });

  it('pg olmayan hata → `pg` alanı hiç eklenmez', async () => {
    const res = await request(buildApp(new Error('boom')))
      .post(ORDER_PATH)
      .send({});
    expect(res.status).toBe(500);

    const payload = loggedPayload();
    expect(payload).not.toHaveProperty('pg');
    expect(payload['route']).toBe('/orders/:orderId/items');
  });

  it('Node `EPIPE` hatası pg sanılmaz (5 büyük harf tuzağı)', async () => {
    const err = Object.assign(new Error('write EPIPE'), {
      code: 'EPIPE',
      syscall: 'write',
    });

    const res = await request(buildApp(err)).post(ORDER_PATH).send({});
    expect(res.status).toBe(500);
    expect(loggedPayload()).not.toHaveProperty('pg');
  });
});

/**
 * T1 — mount öneki (ADR-006 §2 Amendment 2026-11-05).
 *
 * Kapılar bilinçli olarak POZİTİF: *"UUID yok"* bir güvence değildir, çünkü
 * alan `undefined` olsa bile yeşil kalır. Bu yüzden önce **ne olduğu** tam
 * eşitlikle sınanır, sonra UUID'nin yokluğu destekleyici kontrol olarak gelir.
 */
describe('errorHandler — route alanı mount önekini taşır', () => {
  beforeEach(() => {
    errorSpy.mockClear();
  });

  it('PARAMETRELİ mount deseninde log `:id` basar, gerçek UUID basmaz', async () => {
    const groupId = '11111111-2222-3333-4444-555555555555';
    const res = await request(buildParamMountApp(new Error('patladi')))
      .delete(`/products/${PRODUCT_ID}/attribute-groups/${groupId}`)
      .send({});

    expect(res.status).toBe(500);
    const route = loggedPayload()['route'];

    // ① Pozitif: tam desen.
    expect(route).toBe(`${PARAM_MOUNT}/:groupId`);
    // ② Pozitif: önek var ve parametre DESEN olarak geçiyor.
    expect(route).toBe('/products/:id/attribute-groups/:groupId');
    // ③ Destekleyici: hiçbir gerçek kimlik sızmadı (KVKK).
    expect(route).not.toContain(PRODUCT_ID);
    expect(route).not.toContain(groupId);
  });

  it('route eşleşmezse log YALNIZ mount desenini basar', async () => {
    // İstek router'a girer ama hiçbir route eşleşmez → router-içi 404.
    // Bu vakada önek tek başına bile teşhisi hangi router'a daraltır.
    const app = express();
    const router = express.Router();
    router.use((_req, _res, next) => {
      next(new Error('router seviyesi hata'));
    });
    mount(app, '/kds', router);
    app.use(errorHandler);

    const res = await request(app).get('/kds/bilinmeyen').send();

    expect(res.status).toBe(500);
    expect(loggedPayload()['route']).toBe('/kds');
  });

  it('hiçbir mount’a girmeyen hatada route alanı undefined', async () => {
    // App seviyesi hata (ör. body-parser). Kabul edilen sınır: teşhis
    // `method` + `pg` alanlarına kalır.
    const app = express();
    app.use((_req, _res, next) => {
      next(new Error('app seviyesi hata'));
    });
    app.use(errorHandler);

    const res = await request(app).get('/hicbir-yere-mount-degil').send();

    expect(res.status).toBe(500);
    expect(loggedPayload()['route']).toBeUndefined();
  });
});
