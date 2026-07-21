import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import type { Canvas } from '@napi-rs/canvas';
import {
  encodeRaster,
  wrapPrintJob,
  DEFAULT_TAIL_FEED_LINES,
  KITCHEN_TAIL_FEED_LINES,
} from './raster-encode.js';

/**
 * ADR-004 Amendment 9 — `GS v 0` encode + print-job zarfı yapısal testleri (K7).
 */

const GS_V0 = [0x1d, 0x76, 0x30, 0x00];
const RESET = [0x1b, 0x40];
const BUZZER = [0x1b, 0x42, 0x03, 0x02];
// Sabitten TÜRETİLİR: besleme değeri fiziksel bir ayar (koparma çubuğu payı)
// ve zaman içinde kağıtta ayarlanıyor. Sabit sayı yazmak, her ayarda testi
// elle güncellemeyi gerektirir ve testin ne KORUDUĞUNU bulanıklaştırır:
// korunan şey "varsayılan besleme kullanılır", belirli bir satır sayısı değil.
const DEFAULT_FEED = [0x1b, 0x64, DEFAULT_TAIL_FEED_LINES];
const CUT_FULL = [0x1d, 0x56, 0x42, 0x00];

function makeCanvas(height: number): Canvas {
  const c = createCanvas(576, height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 576, height);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 8, height); // en soldaki 8 piksel siyah → ilk data byte 0xff
  return c;
}

function head(out: Uint8Array, n: number): number[] {
  return Array.from(out.subarray(0, n));
}

function containsSub(hay: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

describe('encodeRaster', () => {
  it('GS v 0 başlığı ile açılır (m=0, 72 byte/satır, satır sayısı)', () => {
    const out = encodeRaster(makeCanvas(10));
    // 1D 76 30 00 xL xH yL yH — xL=72 (0x48), rows=10 (0x0a).
    expect(head(out, 8)).toEqual([0x1d, 0x76, 0x30, 0x00, 0x48, 0x00, 0x0a, 0x00]);
  });

  it('tek bant uzunluğu = 8 (başlık) + 72×satır', () => {
    const out = encodeRaster(makeCanvas(10));
    expect(out.length).toBe(8 + 72 * 10);
  });

  it('siyah pikseller bit-set olur (MSB-first: sol-8-siyah → 0xff)', () => {
    const out = encodeRaster(makeCanvas(4));
    expect(out[8]).toBe(0xff); // ilk data byte = x0..7 siyah
  });

  it('128 satırdan uzun bitmap bantlara bölünür (JP80H buffer güvenliği)', () => {
    const out = encodeRaster(makeCanvas(200)); // 128 + 72
    // İki GS v 0 başlığı: ilk bant 128 satır, ikinci 72.
    expect(head(out, 8)).toEqual([0x1d, 0x76, 0x30, 0x00, 0x48, 0x00, 0x80, 0x00]);
    const secondHeaderAt = 8 + 72 * 128;
    expect(Array.from(out.subarray(secondHeaderAt, secondHeaderAt + 8))).toEqual([
      0x1d, 0x76, 0x30, 0x00, 0x48, 0x00, 0x48, 0x00,
    ]);
  });
});

describe('wrapPrintJob', () => {
  it('ESC @ + buzzer + raster + varsayılan feed + CUT_FULL sarar (Amd8 buzzer KORUNUR)', () => {
    const raster = encodeRaster(makeCanvas(10));
    const out = wrapPrintJob(raster);
    expect(head(out, 2)).toEqual(RESET); // ESC @ ilk
    expect(Array.from(out.subarray(2, 6))).toEqual(BUZZER); // buzzer hemen sonra (Amd8)
    expect(Array.from(out.subarray(6, 10))).toEqual(GS_V0); // raster başlar
    expect(Array.from(out.subarray(out.length - 4))).toEqual(CUT_FULL); // CUT son
    expect(containsSub(out, DEFAULT_FEED)).toBe(true); // varsayılan besleme, kesim öncesi
  });

  // ADR-032 Amd1 — mutfak yazıcılarında otomatik kesici YOK (2026-07-20 IZGARA
  // smoke'unda doğrulandı): CUT komutu yutuluyor, kâğıt son satırdan hemen sonra
  // duruyor ve koparma çubuğu fişin içine geliyor. Kuyruk beslemesi bu yüzden
  // parametreli; kasa fişi (kesicisi var) varsayılanda kalır.
  it('feedLines parametresi kuyruk beslemesini değiştirir (kesicisiz mutfak yazıcısı)', () => {
    const out = wrapPrintJob(encodeRaster(makeCanvas(10)), KITCHEN_TAIL_FEED_LINES);
    expect(containsSub(out, [0x1b, 0x64, KITCHEN_TAIL_FEED_LINES])).toBe(true);
    expect(containsSub(out, DEFAULT_FEED)).toBe(false); // varsayılan besleme KULLANILMAZ
    expect(Array.from(out.subarray(out.length - 4))).toEqual(CUT_FULL); // CUT yine son
  });
});
