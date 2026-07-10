// Blok 1 audit findings — intentionally RED until bugs fixed. See docs/audit/01-shared-domain.md
import { describe, expect, it } from 'vitest';
import { maskPhoneForExport } from './pii-mask.js';

/**
 * [SD-S-02] BLOCKER — maskPhoneForExport dejenere olur: TAM 7 haneli girdide
 * `head(3) + tail(4) === toplam uzunluk (7)`, yani ORTADA gizlenen HİÇBİR
 * hane kalmaz. `***` görsel olarak "maskelendi" izlenimi verir ama gerçekte
 * orijinal 7 hanenin TAMAMI çıktıda (baş+son birleşince) görünür.
 *
 * Format spec'i `.claude/memory/decisions.md:9575`: "Telefon (...):
 * `5XX***1234` (ilk 3 + son 4, ortası `***`)" — spec ORTADA gerçek bir gizli
 * bölge varsayar. 7 hanede bu varsayım çöker.
 *
 * Gerçek domain riski: phone.ts'nin kendi test dosyası (phone.test.ts satır
 * 29-31, 61-63) 7 haneli "sabit hat" numaralarını (ör. '5288300') GEÇERLİ bir
 * normalize çıktısı olarak kabul eder — yani bu tam 7-hane durumu POS'ta
 * gerçekten oluşabilecek bir müşteri telefon kaydı biçimidir, uydurma bir
 * kenar durum değildir.
 */
describe('[SD-S-02] maskPhoneForExport: tam 7 haneli girdide sıfır hane gizlenir', () => {
  it('7 haneli girdide maskelenmiş çıktı orijinal digit dizisinin TAMAMINI içermemeli', () => {
    const raw = '5288300'; // phone.test.ts'teki "sabit hat" örneğiyle aynı format
    const digits = raw.replace(/\D/g, '');
    const masked = maskPhoneForExport(raw);
    // Doğru maskeleme kontratı: orta bölge gerçekten gizli olmalı — çıktı
    // ham 7 haneyi ardışık şekilde İÇERMEMELİ.
    expect(masked.includes(digits)).toBe(false);
  });

  it('7 haneli girdide en az 1 hane gerçekten gizlenmeli (head+tail < toplam uzunluk)', () => {
    const raw = '5288300';
    const digits = raw.replace(/\D/g, '');
    // head(3) + tail(4) MUTLAKA toplam haneden KISA olmalı ki ortada "***"
    // gerçek bir gizleme temsil etsin. 7 hanede 3+4=7 → gizli hane SIFIR.
    const HEAD_LEN = 3;
    const TAIL_LEN = 4;
    expect(HEAD_LEN + TAIL_LEN).toBeLessThan(digits.length);
  });
});
