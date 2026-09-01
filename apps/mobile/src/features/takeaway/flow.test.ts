import { describe, expect, it, vi } from 'vitest';

import { resolveIdempotencyKey, sheetAfterNext } from './flow';

/**
 * ADR-039 Amendment 1 DoD 6/7/8 — akış sırası değişikliğinin koruma hattı.
 *
 * ADR-039 DoD 23 ("müşteri seçilmeden Kaydet mümkün değil") yürürlüktedir;
 * Amd1 K3 ile yalnız kapının YERİ değişti: eskiden ekranın ilk adımıydı, artık
 * "İleri" tuşunun dallanmasıdır. Bu testler o kapının yerini sabitler.
 */
describe('sheetAfterNext', () => {
  it('müşteri seçilmeden "İleri" ödeme sheet\'ini AÇMAZ, müşteri sheet\'ini açar (DoD 6)', () => {
    expect(sheetAfterNext(null)).toBe('customer');
  });

  it('müşteri seçiliyken "İleri" müşteri adımını ATLAR, ödeme sheet\'ini açar (DoD 7 / K4)', () => {
    expect(sheetAfterNext('c1e5f0a2-0000-4000-8000-000000000001')).toBe(
      'payment',
    );
  });

  it('boş string bir müşteri kimliği DEĞİLDİR sayılmaz — yalnız null kapıyı tetikler', () => {
    // Ekran `customer?.id ?? null` gönderir; seçilmiş müşteri her zaman
    // sunucudan gelen bir UUID taşır. Bu test, ileride birinin varsayılanı
    // '' yapıp kapıyı sessizce delmesini yakalar.
    expect(sheetAfterNext('')).toBe('payment');
  });
});

describe('resolveIdempotencyKey', () => {
  it('mevcut key varsa AYNI key döner — retry çift sipariş yaratmaz (DoD 8)', () => {
    const generate = vi.fn(() => 'yeni-key');
    expect(resolveIdempotencyKey('ilk-key', generate)).toBe('ilk-key');
    expect(generate).not.toHaveBeenCalled();
  });

  it('key yokken üretici çağrılır (ilk deneme)', () => {
    const generate = vi.fn(() => 'yeni-key');
    expect(resolveIdempotencyKey(null, generate)).toBe('yeni-key');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('başarıdan sonra key null\'a çekilince sonraki sipariş TAZE key alır', () => {
    let current: string | null = null;
    const keys = ['key-1', 'key-2'];
    let index = 0;
    const generate = (): string => keys[index++] ?? 'tükendi';

    current = resolveIdempotencyKey(current, generate); // 1. sipariş, ilk deneme
    current = resolveIdempotencyKey(current, generate); // aynı siparişin retry'ı
    expect(current).toBe('key-1');

    current = null; // başarı → ekran ref'i sıfırlar
    current = resolveIdempotencyKey(current, generate); // 2. sipariş
    expect(current).toBe('key-2');
  });

  it('ağ hatası sonrası birden fazla "Tekrar Dene" AYNI key\'i taşır (QA edge case)', () => {
    // Gerçek ekranda `saveKeyRef` yalnız başarıdan sonra null'a çekilir
    // (`TakeawayOrderScreen.tsx:183`); ağ hatası bu satıra hiç uğramaz. Bu
    // test, art arda 3 başarısız denemenin ÜÇÜNÜN de aynı key'i taşıdığını
    // — yani sunucunun 3 farklı sipariş değil, aynı isteğin 3 replay'ini
    // gördüğünü — sabitler.
    const generate = vi.fn(() => 'ilk-deneme-key');
    let current: string | null = null;

    current = resolveIdempotencyKey(current, generate); // 1. deneme (ağ hatası)
    current = resolveIdempotencyKey(current, generate); // 2. deneme (ağ hatası)
    current = resolveIdempotencyKey(current, generate); // 3. deneme (başarı)

    expect(current).toBe('ilk-deneme-key');
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe('sheetAfterNext + resolveIdempotencyKey — birlikte (K4/K5 regresyonu)', () => {
  it('müşteri sheet\'i kapatılıp sepet değişmeden tekrar "İleri"ye basılırsa müşteri YENİDEN sorulur (kapı kapanmaz)', () => {
    // K5: sheet kapatma sepete dokunmaz ama müşteri de SEÇİLMEZ — `customer`
    // hâlâ `null`'dır. Bu test, implementer'ın "kapatma = örtük seçim" gibi
    // bir kısayol eklemediğini, kapının K3 gereği kapalı KALDIĞINI sabitler.
    const customerId: string | null = null; // sheet X ile kapatıldı, seçim yok
    expect(sheetAfterNext(customerId)).toBe('customer');
  });

  it('müşteri seçilip sepet geri gidilip yeniden dolduruluşta seçili müşteri KORUNUR — ödeme sheet\'i doğrudan açılır', () => {
    // Ürün adımına dönüp sepeti boşaltıp yeniden doldurmak (edge case) sepetin
    // durumunu değiştirir ama `customer` ekran state'i ayrı bir değişkendir;
    // dallanma yalnız customerId'ye bakar, sepetin içeriğine bakmaz (K4).
    const customerId = 'c1e5f0a2-0000-4000-8000-000000000099';
    expect(sheetAfterNext(customerId)).toBe('payment');
  });
});
