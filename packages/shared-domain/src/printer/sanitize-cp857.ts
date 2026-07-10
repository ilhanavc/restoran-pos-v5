/**
 * CP857 öncesi serbest-metin sanitizasyonu — ADR-004 Amd5 K10
 * (chip task_df442130 kapanışı).
 *
 * `encodeCP857` eşlenemeyen karakterde THROW eder (ADR-004 §7 — sessiz bozulma
 * render bug'larını gizlerdi). Serbest metin (ürün adı, not, müşteri adı/adres,
 * garson adı, seçenek snapshot'ı) fişe girmeden bu helper'dan geçirilir:
 *
 *   1. C0 kontrol baytları (<0x20) + DEL (0x7F) SİLİNİR — nottaki ham ESC/GS
 *      dizileri yazıcıya komut olarak sızamaz (kesim/mode enjeksiyonu kapanır).
 *   2. Yaygın eşlenemezler translitere edilir: em/en/figure-dash + minus → '-',
 *      middot/bullet → '.', NBSP → ' '.
 *   3. Kalan CP857-dışı kod noktaları '?' olur (throw yerine görünür bozulma).
 *
 * Türkçe CP857 glyph'leri (ç/ğ/ş/ı/İ/Ş/Ğ/Ç/Ü/Ö/ü/ö) ve yazdırılabilir ASCII
 * DEĞİŞMEZ. `encodeCP857`'nin throw kontratı korunur — sanitize edilmemiş bir
 * alan kalırsa yapısal hata yine görünür (safety-net).
 */

import { isCP857Encodable } from './encode-cp857.js';

const TRANSLIT: Readonly<Record<string, string>> = Object.freeze({
  '‒': '-', // figure dash
  '–': '-', // en dash
  '—': '-', // em dash
  '−': '-', // minus sign
  '·': '.', // middle dot
  '•': '.', // bullet
  ' ': ' ', // no-break space
});

export function sanitizeForCP857(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    if (code < 0x20 || code === 0x7f) continue;
    const translit = TRANSLIT[ch];
    if (translit !== undefined) {
      out += translit;
      continue;
    }
    out += isCP857Encodable(ch) ? ch : '?';
  }
  return out;
}
