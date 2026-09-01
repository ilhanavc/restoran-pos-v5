import { describe, expect, it } from 'vitest';

import type { KdsItem, KdsOrder } from '../../api/schemas';
import { groupIntoBatches } from './batches';

function item(id: string, createdAt: string): KdsItem {
  return {
    id,
    productName: `Ürün ${id}`,
    quantity: 1,
    note: null,
    variantNameSnapshot: null,
    createdAt,
  };
}

function order(
  id: string,
  orderNo: number,
  createdAt: string,
  items: KdsItem[],
  tableCode: string | null = null,
): KdsOrder {
  return {
    id,
    orderNo,
    orderType: 'dine_in',
    tableCodeSnapshot: tableCode,
    areaNameSnapshot: null,
    customerName: null,
    createdAt,
    items,
  };
}

const T0 = '2026-08-31T10:00:00.000Z';
const T1 = '2026-08-31T10:05:00.000Z';
const T2 = '2026-08-31T10:09:00.000Z';

describe('groupIntoBatches (ADR-026 Amd6)', () => {
  it('tek siparişteki iki farklı gönderimi iki karta böler (K1)', () => {
    const batches = groupIntoBatches([
      order('o1', 5, T0, [item('i1', T0), item('i2', T0), item('i3', T2)]),
    ]);

    expect(batches).toHaveLength(2);
    expect(batches.map((b) => b.batchAt)).toEqual([T2, T0]);
  });

  it('her kalem TAM OLARAK bir kartta görünür — tekrar yok (K3)', () => {
    const batches = groupIntoBatches([
      order('o1', 5, T0, [item('i1', T0), item('i2', T0), item('i3', T2)]),
    ]);

    const seen = batches.flatMap((b) => b.items.map((line) => line.id));
    expect(seen).toHaveLength(3);
    expect(new Set(seen)).toEqual(new Set(['i1', 'i2', 'i3']));
    // İlk gönderimin kalemleri ilave kartında TEKRAR ETMEZ.
    expect(batches[0]?.items.map((line) => line.id)).toEqual(['i3']);
    expect(batches[1]?.items.map((line) => line.id)).toEqual(['i1', 'i2']);
  });

  it('aynı zaman damgalı kalemler tek kartta toplanır (bölünme yok)', () => {
    const batches = groupIntoBatches([
      order('o1', 5, T0, [item('i1', T0), item('i2', T0), item('i3', T0)]),
    ]);

    expect(batches).toHaveLength(1);
    expect(batches[0]?.items).toHaveLength(3);
  });

  it('ürün sahibi senaryosu: Masa 5 · Masa 10 · Masa 5 ilave (K4)', () => {
    const batches = groupIntoBatches([
      // Sunucu FIFO gönderir (orders.created_at ASC).
      order('o1', 101, T0, [item('a1', T0), item('a2', T2)], '5'),
      order('o2', 102, T1, [item('b1', T1)], '10'),
    ]);

    expect(
      batches.map((b) => ({
        table: b.tableCodeSnapshot,
        at: b.batchAt,
        isAddition: b.isAddition,
      })),
    ).toEqual([
      { table: '5', at: T2, isAddition: true },
      { table: '10', at: T1, isAddition: false },
      { table: '5', at: T0, isAddition: false },
    ]);
  });

  it('İLAVE rozeti kuralı batchAt > order.createdAt (K6)', () => {
    const batches = groupIntoBatches([
      order('o1', 5, T0, [item('i1', T0), item('i2', T2)]),
    ]);

    expect(batches.find((b) => b.batchAt === T0)?.isAddition).toBe(false);
    expect(batches.find((b) => b.batchAt === T2)?.isAddition).toBe(true);
  });

  it('rozet "listenin ilk kartı" kuralıyla belirlenmez — ilk gönderim servis edilse bile', () => {
    // İlk gönderimin kalemleri `served` olup kuyruktan düştü: kartlar arasında
    // en eski olan artık İLAVE'dir ve öyle etiketlenmelidir.
    const batches = groupIntoBatches([order('o1', 5, T0, [item('i2', T2)])]);

    expect(batches).toHaveLength(1);
    expect(batches[0]?.isAddition).toBe(true);
  });

  it('kart anahtarı `${orderId}:${batchAt}` — sipariş id tek başına benzersiz değil (K5)', () => {
    const batches = groupIntoBatches([
      order('o1', 5, T0, [item('i1', T0), item('i2', T2)]),
    ]);

    expect(batches.map((b) => b.key)).toEqual(['o1:' + T2, 'o1:' + T0]);
    expect(new Set(batches.map((b) => b.key)).size).toBe(batches.length);
  });

  it('sipariş kimliği her kartta korunur — aynı adisyon bağı kopmaz (K5)', () => {
    const batches = groupIntoBatches([
      order('o1', 101, T0, [item('i1', T0), item('i2', T2)], '5'),
    ]);

    expect(batches.every((b) => b.orderNo === 101 && b.orderId === 'o1')).toBe(
      true,
    );
  });

  it('zaman toleransı YOKTUR — 1 ms fark ayrı kart açar (K2)', () => {
    const batches = groupIntoBatches([
      order('o1', 5, T0, [
        item('i1', '2026-08-31T10:00:00.000Z'),
        item('i2', '2026-08-31T10:00:00.001Z'),
      ]),
    ]);

    expect(batches).toHaveLength(2);
  });

  it('kalemsiz sipariş kart üretmez ve boş girdi boş liste döner', () => {
    expect(groupIntoBatches([])).toEqual([]);
    expect(groupIntoBatches([order('o1', 5, T0, [])])).toEqual([]);
  });

  it('paket siparişin alanları karta taşınır', () => {
    const takeaway: KdsOrder = {
      ...order('o9', 900, T0, [item('i1', T0)]),
      orderType: 'takeaway',
      customerName: 'Ahmet Yılmaz',
    };

    const batches = groupIntoBatches([takeaway]);
    expect(batches[0]?.orderType).toBe('takeaway');
    expect(batches[0]?.customerName).toBe('Ahmet Yılmaz');
  });

  it('girdi dizisini ve sipariş nesnelerini değiştirmez (saf fonksiyon)', () => {
    const input = [order('o1', 5, T0, [item('i1', T0), item('i2', T2)])];
    const snapshot = JSON.stringify(input);

    groupIntoBatches(input);

    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
