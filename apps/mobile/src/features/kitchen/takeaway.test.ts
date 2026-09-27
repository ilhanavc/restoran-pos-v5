import { describe, expect, it } from 'vitest';

import type { OpenTakeawayOrder } from '../../api/schemas';
import {
  nextStageAction,
  tableIdForCardTap,
  pickCallablePhone,
  requiresConfirmation,
  sortTakeawayQueue,
  telUri,
} from './takeaway';

function order(
  over: Partial<OpenTakeawayOrder> & { id: string },
): OpenTakeawayOrder {
  return {
    orderNo: 1,
    customerId: 'c1',
    customerName: 'Müşteri',
    totalCents: 1000,
    takeawayStage: 'preparing',
    plannedPaymentType: 'cash',
    createdAt: '2026-09-27T10:00:00.000Z',
    ...over,
  };
}

describe('ADR-039 Amd2 — paket kuyruğu aşama aksiyonu', () => {
  it('preparing → yalnız "Teslimata çıktı" sunulur', () => {
    expect(nextStageAction('preparing')).toEqual({ kind: 'markOut' });
  });

  it('out_for_delivery → yalnız "Teslim edildi" sunulur', () => {
    expect(nextStageAction('out_for_delivery')).toEqual({
      kind: 'markDelivered',
    });
  });

  it('delivered → aksiyon YOK (açık kuyrukta görünmez, defansif dal)', () => {
    expect(nextStageAction('delivered')).toEqual({ kind: 'none' });
  });

  it('iki buton asla aynı anda etkin olmaz (tek aksiyon döner)', () => {
    const stages = ['preparing', 'out_for_delivery', 'delivered'] as const;
    for (const s of stages) {
      const a = nextStageAction(s);
      // Tek bir `kind` — bileşen iki buton render edip ikisini de etkin
      // yapamaz; karar burada tekil.
      expect(['markOut', 'markDelivered', 'none']).toContain(a.kind);
    }
  });
});

describe('ADR-039 Amd2 K6 — onay adımı yalnız para yazan geçişte', () => {
  it('"Teslim edildi" onay İSTER (ödeme satırı yazar, geri alınamaz)', () => {
    expect(requiresConfirmation({ kind: 'markDelivered' })).toBe(true);
  });

  it('"Teslimata çıktı" onay İSTEMEZ (para hareketi yok)', () => {
    expect(requiresConfirmation({ kind: 'markOut' })).toBe(false);
  });

  it('aksiyon yoksa onay da yok', () => {
    expect(requiresConfirmation({ kind: 'none' })).toBe(false);
  });
});

describe('ADR-039 Amd2 — "Ara" butonu numara seçimi', () => {
  it('isPrimary olan numara tercih edilir (sırası önemsiz)', () => {
    const phone = pickCallablePhone([
      { rawPhone: '0212 000 00 00', isPrimary: false },
      { rawPhone: '0532 111 11 11', isPrimary: true },
    ]);
    expect(phone).toBe('0532 111 11 11');
  });

  it('primary yoksa ilk numaraya düşer', () => {
    expect(
      pickCallablePhone([{ rawPhone: '0212 000 00 00', isPrimary: false }]),
    ).toBe('0212 000 00 00');
  });

  it('hiç numara yoksa null → buton gösterilmez', () => {
    expect(pickCallablePhone([])).toBeNull();
  });
});

describe('ADR-039 Amd2 — tel: URI üretimi', () => {
  it('boşluk ve ayırıcılar temizlenir (bazı Android çeviricileri reddediyor)', () => {
    expect(telUri('0532 111 11 11')).toBe('tel:05321111111');
    expect(telUri('(0212) 000-00-00')).toBe('tel:02120000000');
  });

  it('uluslararası önek korunur', () => {
    expect(telUri('+90 532 111 11 11')).toBe('tel:+905321111111');
  });

  it('rakam içermeyen değer null döner (çevirici açmak anlamsız)', () => {
    expect(telUri('')).toBeNull();
    expect(telUri('+')).toBeNull();
    expect(telUri('--- ()')).toBeNull();
  });
});

describe('ADR-039 Amd2 — kuyruk sıralaması', () => {
  it('EN ESKİ ÜSTTE — KDS kuyruğunun (en yeni üstte) TERSİ', () => {
    const sorted = sortTakeawayQueue([
      order({ id: 'yeni', createdAt: '2026-09-27T12:00:00.000Z' }),
      order({ id: 'eski', createdAt: '2026-09-27T09:00:00.000Z' }),
      order({ id: 'orta', createdAt: '2026-09-27T10:30:00.000Z' }),
    ]);
    expect(sorted.map((o) => o.id)).toEqual(['eski', 'orta', 'yeni']);
  });

  it('girdi dizisini MUTASYONA UĞRATMAZ (React state güvenliği)', () => {
    const input = [
      order({ id: 'b', createdAt: '2026-09-27T12:00:00.000Z' }),
      order({ id: 'a', createdAt: '2026-09-27T09:00:00.000Z' }),
    ];
    sortTakeawayQueue(input);
    expect(input.map((o) => o.id)).toEqual(['b', 'a']);
  });
});

describe('ADR-026 Amd3 — kart dokunma hedefi', () => {
  it('masa siparişi → tableId döner (OrderScreen açılır)', () => {
    expect(
      tableIdForCardTap({ orderType: 'dine_in', tableId: 'masa-1' }),
    ).toBe('masa-1');
  });

  it('PAKET siparişi → null (Dilim A: dokunma etkisiz, yanlış ekran açılmaz)', () => {
    expect(
      tableIdForCardTap({ orderType: 'takeaway', tableId: null }),
    ).toBeNull();
  });

  it('paket siparişte tableId dolu gelse bile null döner (tür kararı yönetir)', () => {
    // Defansif: sunucu bir gün paket siparişe masa bağlarsa (masada paket
    // hazırlama gibi) yine OrderScreen'e gitmez — o ekran dine_in kurar.
    expect(
      tableIdForCardTap({ orderType: 'takeaway', tableId: 'masa-9' }),
    ).toBeNull();
  });

  it('masa siparişinde tableId null ise (silinmiş masa) dokunma etkisiz', () => {
    expect(tableIdForCardTap({ orderType: 'dine_in', tableId: null })).toBeNull();
  });
});
