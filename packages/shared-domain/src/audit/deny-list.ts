// ADR-003 §12.2 ile senkron — değişirse migration gerekir
export const DENY_LIST = [
  // İngilizce PII
  'password', 'password_hash', 'token', 'secret', 'api_key',
  'phone', 'email', 'address', 'ip_address',
  'ssn', 'national_id', 'tax_id',
  // PCI-DSS
  'card_number', 'pan', 'cvv', 'cvv2', 'pin', 'track_data',
  'credit_card', 'card_holder',
  // Türkçe varyantlar (kod-içi İngilizce kuralına rağmen v3 payload'lardan gelme riski)
  'sifre', 'tckn', 'telefon', 'eposta', 'adres',
  'kart_no', 'ad_soyad', 'musteri_telefon', 'musteri_adi',
  'vergi_no',
] as const;

export type DenyListKey = (typeof DENY_LIST)[number];
