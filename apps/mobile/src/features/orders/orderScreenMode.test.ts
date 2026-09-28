import { describe, expect, it } from 'vitest';

import {
  activeOrderQueryKey,
  canCreateOrder,
  canMoveItemInMode,
  resolvesTable,
  showsTableActions,
  type OrderScreenMode,
} from './orderScreenMode';

const dineIn: OrderScreenMode = { mode: 'dine_in', tableId: 'masa-1' };
const takeaway: OrderScreenMode = {
  mode: 'takeaway',
  orderId: 'siparis-1',
  customerName: 'Ayşe Yılmaz',
};

describe('ADR-039 Amd4 K2 — önbellek anahtarı kipe göre dallanır', () => {
  it('masa kipi: by-table anahtarı (bugünkü davranış korunur)', () => {
    expect(activeOrderQueryKey(dineIn)).toEqual([
      'orders',
      'by-table',
      'masa-1',
      'active',
    ]);
  });

  it('paket kipi: by-id anahtarı', () => {
    expect(activeOrderQueryKey(takeaway)).toEqual([
      'orders',
      'by-id',
      'siparis-1',
      'active',
    ]);
  });

  it('iki kip ASLA aynı anahtarı üretmez (önbellek çakışması olmaz)', () => {
    // Aynı uuid hem masa hem sipariş kimliği olarak gelse bile anahtarlar ayrı
    // kalmalı; aksi halde bir masanın adisyonu bir paket siparişin verisini
    // gösterebilirdi.
    const sameId = 'aynı-uuid';
    expect(
      activeOrderQueryKey({ mode: 'dine_in', tableId: sameId }),
    ).not.toEqual(
      activeOrderQueryKey({
        mode: 'takeaway',
        orderId: sameId,
        customerName: null,
      }),
    );
  });
});

describe('ADR-039 Amd4 K6 — sipariş OLUŞTURMA yolu (negatif kontrol)', () => {
  // ⚠️ Bu bloğun tamamı ADR-039 Amd4 DoD 5'in kanıtıdır. Paket kipinde
  // `POST /orders` çağrılırsa sahipsiz/yinelenmiş sipariş üretilir — veri
  // bütünlüğü sınıfı bir hata. Ekran bu kararı kendi içinde tekrar ETMEZ,
  // `canCreateOrder`'a sorar; dolayısıyla kuralın yaşadığı yer burasıdır.

  it('PAKET kipinde sipariş oluşturma yolu KAPALIDIR', () => {
    expect(canCreateOrder(takeaway)).toBe(false);
  });

  it('masa kipinde oluşturma yolu açıktır (boş masaya ilk sipariş)', () => {
    expect(canCreateOrder(dineIn)).toBe(true);
  });

  it('müşteri adı olmayan paket siparişinde de kapalıdır', () => {
    // Ad yokluğu bir "yeni sipariş" sinyali DEĞİLDİR; ekran yine mevcut bir
    // siparişle açılmıştır. Ad yalnız görüntü etiketidir (K4).
    expect(
      canCreateOrder({
        mode: 'takeaway',
        orderId: 'siparis-2',
        customerName: null,
      }),
    ).toBe(false);
  });
});

describe('ADR-039 Amd4 K5 — masa-özgü aksiyonlar paket kipinde gizlenir', () => {
  it('masa 3-nokta menüsü: masa kipinde görünür, paket kipinde görünmez', () => {
    expect(showsTableActions(dineIn)).toBe(true);
    expect(showsTableActions(takeaway)).toBe(false);
  });

  it('ADR-035 kalem taşıma: paket kipinde kapalı (web paritesi)', () => {
    // Web de aynı kuralı uygular: OrderScreenPage.tsx:352
    // `canMoveItemRole && !isTakeaway`. Mobil bir yetenek kaybetmiyor.
    expect(canMoveItemInMode(dineIn)).toBe(true);
    expect(canMoveItemInMode(takeaway)).toBe(false);
  });

  it('masa çözümü paket kipinde YAPILMAZ → "masa bulunamadı" guard\'ı asla tetiklenmez', () => {
    // Bu dal gözden kaçarsa HER paket siparişi hata ekranında açılır.
    expect(resolvesTable(dineIn)).toBe(true);
    expect(resolvesTable(takeaway)).toBe(false);
  });
});
