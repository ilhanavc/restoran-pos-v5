/**
 * Raster bitmap → ESC/POS `GS v 0` encode + print-job zarfı (ADR-004 Amd9 K3/K4).
 *
 * PoC-kanıtlı (2026-07-19, JP80H mutfak + POS-80 kasa fiziksel bastı): 576px
 * bitmap → 1-bit (luminance < 128 → siyah) → `GS v 0` bant(lar). Bantlama
 * (128-satır/bant) JP80H küçük-buffer güvenliği. codepage/ESC-t/printMode YOK —
 * piksel neyse o basılır (K3).
 */

import type { Canvas } from '@napi-rs/canvas';
import { ESC_POS, buzzer, concat, feed } from '@restoran-pos/shared-domain';

/** Bant yüksekliği (satır/bant) — JP80H küçük-buffer güvenliği (PoC ✓). */
const BAND = 128;
/** Luminance eşiği: altı siyah (yakılır), üstü beyaz. */
const THRESHOLD = 128;

/** Tek bant için `GS v 0` başlık + bit-pack veri üretir (MSB-first). */
function encodeBand(
  img: Uint8ClampedArray,
  width: number,
  bytesPerRow: number,
  y0: number,
  rows: number,
): Uint8Array {
  // GS v 0 m xL xH yL yH : m=0 normal, xL/xH = byte/satır, yL/yH = satır sayısı.
  const header = new Uint8Array([
    0x1d,
    0x76,
    0x30,
    0x00,
    bytesPerRow & 0xff,
    (bytesPerRow >> 8) & 0xff,
    rows & 0xff,
    (rows >> 8) & 0xff,
  ]);
  const data = new Uint8Array(rows * bytesPerRow);
  for (let ry = 0; ry < rows; ry++) {
    const rowBase = (y0 + ry) * width;
    const outBase = ry * bytesPerRow;
    for (let x = 0; x < width; x++) {
      const i = (rowBase + x) * 4;
      const r = img[i] ?? 0;
      const g = img[i + 1] ?? 0;
      const b = img[i + 2] ?? 0;
      const lum = r * 0.299 + g * 0.587 + b * 0.114;
      if (lum < THRESHOLD) {
        const idx = outBase + (x >> 3);
        data[idx] = (data[idx] ?? 0) | (1 << (7 - (x & 7)));
      }
    }
  }
  return concat(header, data);
}

/**
 * Canvas bitmap'ini `GS v 0` raster bant(lar)ına kodlar. width % 8 = 0 olmalı
 * (576 → 72 byte/satır). Yalnız bitmap baytları döner (zarf {@link wrapPrintJob}).
 */
export function encodeRaster(canvas: Canvas): Uint8Array {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, width, height).data;
  const bytesPerRow = width >> 3; // width / 8
  const parts: Uint8Array[] = [];
  for (let y0 = 0; y0 < height; y0 += BAND) {
    const rows = Math.min(BAND, height - y0);
    parts.push(encodeBand(img, width, bytesPerRow, y0, rows));
  }
  return concat(...parts);
}

/**
 * Varsayılan kuyruk beslemesi — kesicisi olan yazıcılar için (kasa POS-80).
 *
 * 2026-07-21: ürün sahibi "fişlerin altında çok fazla boşluk var, %30 azalt"
 * dedi → 3 → 2. Kesici çalıştığı için burada besleme yalnız kesme payıdır;
 * mutfaktaki koparma-çubuğu kısıtı (aşağıda) BURADA GEÇERLİ DEĞİLDİR.
 */
export const DEFAULT_TAIL_FEED_LINES = 2;

/**
 * Mutfak yazıcıları için kuyruk beslemesi (ADR-032 Amd1 — fiziksel smoke bulgusu).
 *
 * Mutfak yazıcılarında (FIRIN2025 / IZGARA2025, ikisi de `POS80ENG`) **otomatik
 * kesici YOKTUR** — 2026-07-20 IZGARA smoke'unda doğrulandı; Adisyo da o
 * yazıcıda kesmiyor. `CUT_FULL` (`GS V 66 0`) komutu yutuluyor ve kâğıt son
 * basılan satırdan hemen sonra duruyor → koparma çubuğu fişin İÇİNE denk
 * geliyor, personel fişin son satırlarını yırtıyor.
 *
 * Bu yüzden mutfak/iptal fişlerinde kuyruk beslemesi artırılır: son satır
 * koparma çubuğunu geçsin. Kasa fişi DEĞİŞMEZ — orada kesici çalışıyor ve
 * fazladan besleme her fişte boşa kâğıt demek olurdu.
 *
 * Değer **kağıt üzerinde ampirik olarak** bulundu (2026-07-20, IZGARA2025):
 * 3 satır yetersizdi (koparma fişin içine geliyordu), 8 satırda ürün sahibi
 * onayladı. Ölçü birimi `ESC d n` satır beslemesidir (~4,2 mm/satır @203 dpi).
 *
 * 2026-07-21: ürün sahibi "%30 azalt" dedi → 8 → 6. **Bilinçli olarak 30'dan
 * az kısaltıldı**: bu değerin alt sınırı estetik değil FİZİKSEL — koparma
 * çubuğunun fişin son satırından SONRAYA denk gelmesi gerekir; 3'te bu kısıt
 * ihlal ediliyordu ve personel fişi yırtıyordu (bir gün önce çözülen sorun).
 * Toplam alt boşluk PAD_BOTTOM ile birlikte hesaplanır: 28px+8satır (~37mm)
 * → 20px+6satır (~28mm) ≈ %25. Kağıtta doğrulanmalıdır.
 */
export const KITCHEN_TAIL_FEED_LINES = 6;

/**
 * Raster baytlarını basılabilir bir print-job byte akışına sarar:
 * `ESC @` (RESET) + `buzzer()` (Amd8 KORUNUR — basımda bip) + raster +
 * `feed(feedLines)` + `CUT_FULL`. codepage/text-mode YOK (K3).
 *
 * @param feedLines Kesme/koparma öncesi besleme satırı sayısı. Kesicisi olan
 *   yazıcılarda varsayılan yeterlidir; kesicisiz mutfak yazıcıları için
 *   {@link KITCHEN_TAIL_FEED_LINES} geçilir.
 */
export function wrapPrintJob(
  rasterBytes: Uint8Array,
  feedLines: number = DEFAULT_TAIL_FEED_LINES,
): Uint8Array {
  return concat(ESC_POS.RESET, buzzer(), rasterBytes, feed(feedLines), ESC_POS.CUT_FULL);
}
