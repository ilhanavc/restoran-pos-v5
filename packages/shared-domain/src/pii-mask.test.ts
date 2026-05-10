import { describe, expect, it } from 'vitest';
import { maskAddress, maskCustomerName, maskPhoneForExport } from './pii-mask.js';

describe('maskPhoneForExport', () => {
  it('11 hane TR cep → ilk 3 + *** + son 4', () => {
    expect(maskPhoneForExport('05551234567')).toBe('055***4567');
  });

  it('+90 prefix temizlenir, format korunur', () => {
    expect(maskPhoneForExport('+905551234567')).toBe('905***4567');
  });

  it('boşluk + parantezli format → digit-only sonra mask', () => {
    expect(maskPhoneForExport('(0555) 123 45 67')).toBe('055***4567');
  });

  it('null girdi → ***', () => {
    expect(maskPhoneForExport(null)).toBe('***');
  });

  it('undefined girdi → ***', () => {
    expect(maskPhoneForExport(undefined)).toBe('***');
  });

  it('boş string → ***', () => {
    expect(maskPhoneForExport('')).toBe('***');
  });

  it('7 haneden kısa (örn. 6 hane) → ***', () => {
    expect(maskPhoneForExport('123456')).toBe('***');
  });

  it('tam 7 hane → 123***4567 (head 3 + tail 4 overlap kabul)', () => {
    expect(maskPhoneForExport('1234567')).toBe('123***4567');
  });

  it('sabit hat 10 hane → mask uygulanır', () => {
    expect(maskPhoneForExport('2123456789')).toBe('212***6789');
  });
});

describe('maskCustomerName', () => {
  it('iki kelime ad-soyad → ilk isim + soyad ilk harfi + ***', () => {
    expect(maskCustomerName('Ahmet Kaya')).toBe('Ahmet K***');
  });

  it('tek kelime → tam ad (mask yok)', () => {
    expect(maskCustomerName('Ahmet')).toBe('Ahmet');
  });

  it('üç kelime → sadece ilk soyad ilk harfi', () => {
    expect(maskCustomerName('Ahmet Kaya Yılmaz')).toBe('Ahmet K***');
  });

  it('boş string → boş string', () => {
    expect(maskCustomerName('')).toBe('');
  });

  it('null → boş string', () => {
    expect(maskCustomerName(null)).toBe('');
  });

  it('undefined → boş string', () => {
    expect(maskCustomerName(undefined)).toBe('');
  });

  it('TR karakter güvenli (Çağla Şahin)', () => {
    expect(maskCustomerName('Çağla Şahin')).toBe('Çağla Ş***');
  });

  it('baştaki/sondaki boşluk trim edilir', () => {
    expect(maskCustomerName('  Ayşe Demir  ')).toBe('Ayşe D***');
  });

  it('birden fazla boşluk tolere edilir', () => {
    expect(maskCustomerName('Mehmet   Öztürk')).toBe('Mehmet Ö***');
  });
});

describe('maskAddress', () => {
  it('Sokak/No, Mahalle, İlçe/İl → mahalle ve sonrası', () => {
    expect(
      maskAddress('Atatürk Cad. No:12, Kızılay Mah., Çankaya/Ankara'),
    ).toBe('Kızılay Mah., Çankaya/Ankara');
  });

  it('mahalle başta → tam string döner (Mahallesi formu)', () => {
    expect(maskAddress('Çankaya Mahallesi 5. Sokak')).toBe(
      'Çankaya Mahallesi 5. Sokak',
    );
  });

  it('boş string → boş string', () => {
    expect(maskAddress('')).toBe('');
  });

  it('null → boş string', () => {
    expect(maskAddress(null)).toBe('');
  });

  it('undefined → boş string', () => {
    expect(maskAddress(undefined)).toBe('');
  });

  it('mahalle yok → boş string (sokak/no tek başına maskelenmiş kabul)', () => {
    expect(maskAddress('Sokak No:5')).toBe('');
  });

  it('case-insensitive Mah. eşleşir', () => {
    expect(maskAddress('Test Cad. No:1, MERKEZ MAH., Ankara')).toBe(
      'MERKEZ MAH., Ankara',
    );
  });

  it('virgülsüz adres + Mah. ortada → tüm string döner (segment ayrımı yok)', () => {
    // Virgül yoksa segment ayrımı yok — implementasyon güvenli tarafta kalır
    // ve tüm string'i geri verir. Sokak prefix'ini gizlemek isteyen tenant
    // adresleri virgülle ayırarak girmeli (TR adres formatı zaten bu).
    expect(maskAddress('Test Cad No 1 Merkez Mah. Ankara')).toBe(
      'Test Cad No 1 Merkez Mah. Ankara',
    );
  });

  it('baştaki/sondaki boşluk trim edilir', () => {
    expect(maskAddress('  Cad. No:1, Merkez Mah., Ankara  ')).toBe(
      'Merkez Mah., Ankara',
    );
  });

  it('Mahallesi (uzun form) Mah. öncesinde gelir, ikisi de varsa uzun form tercih', () => {
    expect(
      maskAddress('Cad No 1, Merkez Mahallesi, Yenimah. Sokak, Ankara'),
    ).toBe('Merkez Mahallesi, Yenimah. Sokak, Ankara');
  });
});
