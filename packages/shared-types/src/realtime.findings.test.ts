import { describe, expect, it } from 'vitest';
import { KitchenOrderSentPayloadSchema } from './realtime.js';

/**
 * Blok 2 denetim bulgusu SD-T-B-01 — KASITLI KIRMIZI karakterizasyon.
 *
 * Şema (realtime.ts:126-138) item alanını `qty` + top-level `tableId`'yi
 * ZORUNLU (nullable ama key şart) ilan eder. Gerçek emit-site'lar
 * (apps/api/src/routes/orders.ts:599/1013/1147) ise `quantity` alan adıyla
 * ve `tableId`'siz emit eder — üstelik zod-parse'lı emit helper'ını
 * (realtime/emit.ts) atlayarak DOĞRUDAN `io.emit()` çağırır. Tüketici
 * (apps/web KDS) `quantity` okuduğu için tel bugün çalışıyor; yayınlanan
 * kontrat (şema) yalan söylüyor.
 *
 * Bu test, GERÇEK emit payload'ının şemadan geçmesini bekler; şema tel
 * formatına hizalanana (veya emit parse'lı helper'a taşınana) kadar
 * KIRMIZI kalır. Fix sonrası yeşile döner ve kontrat regresyon kilidi olur.
 */
describe('kitchen.orderSent emit-site ↔ şema kontratı (SD-T-B-01)', () => {
  // orders.ts:599 (takeaway dalı) emit'inin birebir şekli:
  const realEmitPayload = {
    orderId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    orderType: 'takeaway',
    items: [
      {
        id: '9b2e6f4a-1c3d-4e5f-8a7b-2c1d0e9f8a7b',
        productName: 'Kıymalı Pide',
        quantity: 2, // şema `qty` bekliyor
      },
    ],
    // tableId: yok — şema key'i zorunlu sayıyor
  };

  it('SD-T-B-01a gerçek takeaway emit payloadı şemadan geçmeli (bugün: quantity≠qty → FAIL)', () => {
    const result = KitchenOrderSentPayloadSchema.safeParse(realEmitPayload);
    expect(result.success).toBe(true);
  });

  it('SD-T-B-01b tableId göndermeyen gerçek emit şekli şemaca kabul edilmeli (bugün: required → FAIL)', () => {
    // Alan adını şemaya uydursak bile tableId eksikliği tek başına düşürüyor:
    const qtyFixed = {
      ...realEmitPayload,
      items: [
        {
          id: '9b2e6f4a-1c3d-4e5f-8a7b-2c1d0e9f8a7b',
          productName: 'Kıymalı Pide',
          qty: 2,
        },
      ],
    };
    const result = KitchenOrderSentPayloadSchema.safeParse(qtyFixed);
    expect(result.success).toBe(true);
  });
});
