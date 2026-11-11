import { describe, expect, it } from 'vitest';

import {
  resolveActiveOrderIdForTable,
  type TableActiveOrderProjection,
} from './activeOrder';

/**
 * #790 — masanın açık adisyonu masa tahtası projeksiyonundan çözülür.
 *
 * Kaybedilen davranış şuydu: adisyon `GET /orders?tableId=` ile aranıyordu, o uç
 * tarih göndermeyen istemciye **bugünün** siparişlerini döndürüyor ve gece
 * yarısını aşan açık adisyon listede hiç görünmüyordu. Projeksiyon tarihten
 * bağımsızdır (`GET /tables` yalnız terminal olmayan statüyü süzer), bu yüzden
 * testlerin "dün açılmış" vakası da buradan geçer: çözüm fonksiyonu tarih
 * BİLMEZ ve bilmemesi garantinin kendisidir.
 */
describe('resolveActiveOrderIdForTable', () => {
  const YESTERDAYS_ORDER = '11111111-1111-4111-8111-111111111111';
  const TABLE_WITH_BILL = 'cd78f74f-0000-4000-8000-000000000001';
  const EMPTY_TABLE = 'cd78f74f-0000-4000-8000-000000000002';

  const tables: TableActiveOrderProjection[] = [
    { id: TABLE_WITH_BILL, active_order_id: YESTERDAYS_ORDER },
    { id: EMPTY_TABLE, active_order_id: null },
  ];

  it('dolu masada adisyon kimliğini döner (siparişin günü ne olursa olsun)', () => {
    expect(resolveActiveOrderIdForTable(tables, TABLE_WITH_BILL)).toBe(
      YESTERDAYS_ORDER,
    );
  });

  it('boş masada null döner', () => {
    expect(resolveActiveOrderIdForTable(tables, EMPTY_TABLE)).toBeNull();
  });

  it('projeksiyonda olmayan masada null döner (silinmiş / RLS 0 satır)', () => {
    expect(resolveActiveOrderIdForTable(tables, 'yok-boyle-bir-masa')).toBeNull();
  });

  it('boş projeksiyonda null döner', () => {
    expect(resolveActiveOrderIdForTable([], TABLE_WITH_BILL)).toBeNull();
  });
});
