import { describe, it, expect } from 'vitest';
import {
  ATTRIBUTE_EXTRA_PRICE_CAP_CENTS,
  AttributeOptionCreateRequestSchema,
  AttributeOptionUpdateRequestSchema,
} from './attribute.js';

/**
 * ADR-012 Amendment 1 (2026-07-22) — ek ücret tavanı ±100 TL → ±1.000 TL.
 *
 * Tetikleyen canlı olay: ürün sahibi "duble kaşarlı" özelliğini **130 TL** ile
 * eklemek istedi, ekran "eklenemedi" dedi. 13000 kuruş eski tavanı (10000)
 * aşıyordu.
 *
 * ⚠️ Bu testler yalnız ZOD katmanını kanıtlar. Aynı sınır DB'de de CHECK olarak
 * duruyor (Migration 050); ikisinin birlikte gevşediğini gösteren uçtan uca
 * kanıt `apps/api` entegrasyon testindedir.
 */
describe('AttributeOption ek ücret tavanı (ADR-012 Amd1)', () => {
  it('tavan ±1.000 TL (100000 kuruş)', () => {
    expect(ATTRIBUTE_EXTRA_PRICE_CAP_CENTS).toBe(100_000);
  });

  it('130 TL (13000 kuruş) KABUL — eski ±100 TL tavanında reddediliyordu', () => {
    const parsed = AttributeOptionCreateRequestSchema.safeParse({
      name: 'Duble Kaşarlı',
      extraPriceCents: 13_000,
    });
    expect(parsed.success).toBe(true);
  });

  it('tam tavan (±100000) kabul, bir kuruş fazlası red', () => {
    for (const v of [100_000, -100_000]) {
      expect(
        AttributeOptionCreateRequestSchema.safeParse({ name: 'Sınır', extraPriceCents: v })
          .success,
      ).toBe(true);
    }
    for (const v of [100_001, -100_001]) {
      expect(
        AttributeOptionCreateRequestSchema.safeParse({ name: 'Aşan', extraPriceCents: v })
          .success,
      ).toBe(false);
    }
  });

  it('tavan KALDIRILMADI — kuruş/TL karıştırması hâlâ yakalanır (13000 TL girişi)', () => {
    // 130 TL yerine 13000 TL yazılırsa = 1.300.000 kuruş → red.
    const parsed = AttributeOptionCreateRequestSchema.safeParse({
      name: 'Yanlış birim',
      extraPriceCents: 1_300_000,
    });
    expect(parsed.success).toBe(false);
  });

  it('PATCH şeması da aynı tavanı uygular', () => {
    expect(
      AttributeOptionUpdateRequestSchema.safeParse({ extraPriceCents: 13_000 }).success,
    ).toBe(true);
    expect(
      AttributeOptionUpdateRequestSchema.safeParse({ extraPriceCents: 100_001 }).success,
    ).toBe(false);
  });

  it('kuruş integer kalır — float reddedilir (CLAUDE.md float yasağı)', () => {
    expect(
      AttributeOptionCreateRequestSchema.safeParse({ name: 'Float', extraPriceCents: 13_000.5 })
        .success,
    ).toBe(false);
  });
});
