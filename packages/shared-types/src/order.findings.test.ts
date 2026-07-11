import { describe, it, expect } from 'vitest';
import {
  OrderCreateApiRequestSchema,
  OrderRowSchema,
  OrderItemSchema,
} from './order.js';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const VALID_TABLE_UUID = '33333333-3333-4333-8333-333333333333';

/**
 * Blok 2 / Hat A — KASITLI KIRMIZI karakterizasyon testleri (order.ts).
 */

/**
 * Bulgu: SD-T-A-02 [HIGH][BUG] OrderCreateApiRequestSchema takeaway/delivery
 * siparişlerde tableId'nin NULL olmasını ZORLAMIYOR.
 *
 * Kanıt: order.ts:113-116
 *   .refine((data) => data.orderType !== 'dine_in' || data.tableId !== null, ...)
 * Bu refine yalnız "dine_in ise tableId dolu olmalı" kuralını uygular.
 * "dine_in DEĞİLSE tableId NULL olmalı" kuralı YOK. DB tarafında da bunu
 * engelleyen bir CHECK constraint bulunmuyor (packages/db/migrations grep:
 * table_id + CHECK kombinasyonu yok).
 *
 * Senaryo: orderType='takeaway' + tableId=<dolu bir masanın UUID'i> → şema
 * KABUL EDER. Masa durumu orders JOIN ile türetildiği için (table.ts:9 yorum,
 * ADR-003 §14.2.B) bu, gerçekte boş bir masayı "dolu" gösterebilir veya
 * paket siparişi yanlışlıkla bir masaya bağlayabilir — operasyonel veri
 * bütünlüğü hatası.
 *
 * Öneri: refine'a ikinci kol eklenmeli:
 *   data.orderType === 'dine_in' || data.tableId === null
 * Etiket: MVP-fix
 */
describe('SD-T-A-02 — takeaway/delivery siparişte tableId zorunlu-null değil (kasıtlı kırmızı)', () => {
  it('SD-T-A-02a takeaway + dolu tableId REDDEDİLMELİ (masa yalnız dine_in içindir)', () => {
    const r = OrderCreateApiRequestSchema.safeParse({
      tableId: VALID_TABLE_UUID,
      orderType: 'takeaway',
    });
    // Beklenen (doğru) davranış: reddet. Şu an: kabul ediyor → KIRMIZI.
    expect(r.success).toBe(false);
  });

  it('SD-T-A-02b delivery + dolu tableId REDDEDİLMELİ', () => {
    const r = OrderCreateApiRequestSchema.safeParse({
      tableId: VALID_TABLE_UUID,
      orderType: 'delivery',
    });
    expect(r.success).toBe(false);
  });
});

/**
 * Bulgu: SD-T-A-01 (money.findings.test.ts kökeni) — OrderRowSchema.totalCents
 * ve OrderItemSchema.unitPriceCents/totalCents, MoneyCentsSchema'yı re-use
 * ettiği için AYNI üst-sınır eksikliğini order düzeyinde de miras alır.
 * Bu testler bulgunun order.ts'e YAYILDIĞINI (money ↔ order tutarlılığı
 * negatif yönde tutarlı — ikisi de sınırsız) kanıtlar.
 * Etiket: MVP-fix (money.ts düzeltilirse burası da otomatik düzelir)
 */
describe('SD-T-A-01 (order.ts yayılımı) — order/item money alanlarında üst sınır yok (kasıtlı kırmızı)', () => {
  const validOrderRow = {
    id: VALID_UUID,
    tenantId: VALID_UUID,
    tableId: null,
    orderType: 'takeaway' as const,
    status: 'open' as const,
    storeDate: '2026-07-11',
    orderNo: 1,
    waiterUserId: null,
    note: null,
    createdAt: '2026-07-11T10:00:00.000Z',
    updatedAt: '2026-07-11T10:00:00.000Z',
  };

  it('SD-T-A-01e OrderRowSchema.totalCents INT4 üstü tutarı reddetmeli', () => {
    const r = OrderRowSchema.safeParse({ ...validOrderRow, totalCents: 5_000_000_000 });
    expect(r.success).toBe(false);
  });

  const validOrderItem = {
    id: VALID_UUID,
    orderId: VALID_UUID,
    productId: VALID_UUID,
    productName: 'Karışık Pide',
    categoryNameSnapshot: 'Pideler',
    quantity: 1,
    isComped: false,
    note: null,
    variantIdSnapshot: null,
    variantNameSnapshot: null,
    variantPriceDeltaCentsSnapshot: null,
    createdByUserId: null,
    createdByName: 'Test Garson',
    createdAt: '2026-07-11T10:00:00.000Z',
  };

  it('SD-T-A-01f OrderItemSchema.unitPriceCents INT4 üstü tutarı reddetmeli', () => {
    const r = OrderItemSchema.safeParse({
      ...validOrderItem,
      unitPriceCents: 9_999_999_999,
      totalCents: 9_999_999_999,
    });
    expect(r.success).toBe(false);
  });
});
