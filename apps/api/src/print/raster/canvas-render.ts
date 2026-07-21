/**
 * Raster fiş çizim katmanı (ADR-004 Amendment 9) — YALNIZCA-API (K1).
 *
 * `@napi-rs/canvas` (Skia, prebuilt binary — 0 sistem-bağımlılığı) ile 576px
 * genişlikte bir fiş bitmap'i çizer. `shared-domain`'e KONMAZ: web + mobil onu
 * import ediyor, native Node-binary Vite/Metro bundle'ını kırar (K1). Çizim
 * saf-tipografi (font-size/weight/hiza); ESC/POS baytı ÜRETMEZ — encode
 * {@link ./raster-encode} katmanının işi.
 *
 * İki-geçiş yükseklik (K4): çizim komutları önce bir listede toplanır (her biri
 * yükseklik-katkısıyla), toplam H hesaplanır, `createCanvas(576, H)` açılır,
 * sonra çizilir. Proportional font → sağ-hiza `measureText` ile.
 *
 * Font: DejaVu Sans (regular + bold; Bitstream-Vera/Arev türevi, gömme-serbest;
 * Türkçe İ/ş/ı/ğ/ç/ö/ü + ₺ (U+20BA) glyph'leri DOĞRULANDI). `import.meta.url` →
 * runtime font yolu (prod tsx-from-src'de `src/print/raster/fonts/` git-pull'la gelir).
 */

import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import type { Canvas, SKRSContext2D } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';

/** 80mm termal kağıt @ 203 DPI = 8 nokta/mm → 576 nokta. width%8=0 (GS v 0 için). */
export const RECEIPT_WIDTH = 576;

/** Yatay kenar boşluğu (sol/sağ). */
const PAD_X = 20;
/** Üst kenar boşluğu. */
const PAD_TOP = 16;
/**
 * Alt kenar boşluğu (kesim payı; feed + CUT'a ek görsel margin).
 *
 * 2026-07-21: iki turda 28 → 20 → 10. Bu bitmap'in İÇİNDEKİ boşluktur ve
 * her fiş türünü etkiler; kuyruk beslemesi (`raster-encode.ts`) ondan ayrı
 * bir katmandır. Kesicisi olan kasa yazıcısında koparma kısıtı yok, mutfakta
 * var — o yüzden asıl sınır beslemede, burada değil.
 */
const PAD_BOTTOM = 10;
/** İki-kolon satırda sol metin ile sağ değer arası minimum boşluk. */
const GAP = 16;

/**
 * Fiş tipografi ölçeği (K5 — 203 DPI; satır-yüksekliği ≈ boyut × 1.35).
 * Adisyo-kalite DENGELİ hiyerarşi: başlık büyük, gövde okunaklı, meta küçük.
 */
export const SIZES = {
  /** İşletme adı (bill/kitchen-B başlık). */
  header: 40,
  /** İptal başlığı ("KALEM İPTAL" / "ADİSYON İPTAL"). */
  title: 36,
  /** Mutfak seslenişi "- N -" günlük-sıra. */
  callout: 40,
  /** TUTAR / toplam satırı. */
  total: 34,
  /** Mutfak/iptal kalem adı (uzaktan-okunur BÜYÜK). */
  itemBig: 30,
  /** Bill kalem adı. */
  itemName: 24,
  /** Meta satırları (Adisyon No / Garson / etiketler). S99 kağıt-smoke: 22→26
   * (üst-bilgi "daha belirgin ve büyük" — kullanıcı geri bildirimi). */
  meta: 26,
  /**
   * Fiş üst-bilgisinin ÇAPA satırı: "Adisyon No: N" + masa etiketi.
   *
   * Aşçının fişe baktığında ilk aradığı şey masa; adisyon no ikinci. Bu yüzden
   * o satır meta'dan ayrılıp kalem adlarıyla (itemBig) aynı ağırlığa çekildi —
   * S99'daki 22→26 artışı ürün sahibine yeterli gelmedi (2026-07-20).
   * itemBig'i AŞMAZ: mutfak fişinde ürünler baskın kalmalı.
   */
  headerAnchor: 30,
  /** Tarih-saat + modifiye/not alt-satırları. S99: 20→24 (parantez-içi
   * özellikler "biraz daha büyük"). */
  small: 24,
} as const;

const FONT_REGULAR = 'ReceiptSans';
const FONT_BOLD = 'ReceiptSansBold';

let fontsRegistered = false;
/** DejaVu Sans regular + bold'u bir kez kaydeder (ESM singleton; idempotent). */
function ensureFonts(): void {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(
    fileURLToPath(new URL('./fonts/DejaVuSans.ttf', import.meta.url)),
    FONT_REGULAR,
  );
  GlobalFonts.registerFromPath(
    fileURLToPath(new URL('./fonts/DejaVuSans-Bold.ttf', import.meta.url)),
    FONT_BOLD,
  );
  fontsRegistered = true;
}

/** CSS font string üretir (bold → ayrı gerçek-bold face; sahte-kalın YOK). */
function fontString(size: number, bold: boolean): string {
  return `${size}px ${bold ? FONT_BOLD : FONT_REGULAR}`;
}

/**
 * Kontrol-baytı (C0 0x00–0x1F + DEL/C1 0x7F–0x9F) süzer. İKİ nedenle ŞART:
 * (1) Skia (`@napi-rs/canvas`) NUL içeren string'i C-string'e çeviremez →
 *     `measureText`/`fillText` THROW eder;
 * (2) diğer kontrol baytları bitmap'te tofu-kutu çizerdi.
 * ESC/POS ENJEKSİYON riski raster'da zaten mimari-olarak YOK (metin piksel olur,
 * yazıcı komutu olarak yorumlanamaz); bu yalnız render-dayanıklılığı + estetik.
 * CP857 kısıtı YOK → Türkçe/₺/tam-Unicode korunur (Amd9 K4).
 */
function sanitizeText(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue;
    out += ch;
  }
  return out;
}

/** Satır kutusu yüksekliği: boyut × 1.35 (yuvarlanmış). Saf — birim-test edilir. */
export function computeLineHeight(size: number): number {
  return Math.round(size * 1.35);
}

/** Yatay çizgi stili. */
export type RuleStyle = 'solid' | 'dashed';

/** Metin çizim seçenekleri. */
export interface TextOptions {
  size: number;
  bold?: boolean;
  /** Ekstra sol girinti (modifiye/not alt-satırları için). */
  indentPx?: number;
}

/** En geniş sığan önek uzunluğu (sert kelime bölme için). */
function longestPrefix(
  measureWidth: (text: string) => number,
  word: string,
  maxWidth: number,
): number {
  let cut = word.length;
  while (cut > 1 && measureWidth(word.slice(0, cut)) > maxWidth) cut--;
  return cut;
}

/**
 * Greedy kelime-kaydırma: metni `maxWidth`'e sığan satırlara böler. Kolon
 * genişliğini aşan tek kelime sert bölünür (satır taşmaz). `measureWidth`
 * enjekte edilir → saf/test-edilebilir (font ölçümünden bağımsız).
 */
export function wrapToWidth(
  measureWidth: (text: string) => number,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const raw of words) {
    let word = raw;
    while (measureWidth(word) > maxWidth && word.length > 1) {
      if (current !== '') {
        lines.push(current);
        current = '';
      }
      const cut = longestPrefix(measureWidth, word, maxWidth);
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const candidate = current === '' ? word : `${current} ${word}`;
    if (measureWidth(candidate) <= maxWidth) {
      current = candidate;
    } else {
      if (current !== '') lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/** Tek bir çizim komutu: yükseklik-katkısı + çizim closure'ı (top = üst y). */
interface DrawCommand {
  readonly height: number;
  draw(ctx: SKRSContext2D, top: number): void;
}

/**
 * Satır-satır fiş çizim builder'ı (iki-geçiş yükseklik). Zincirlenebilir API:
 * `new ReceiptCanvas().centered(...).rule().leftRight(...).build()`.
 */
export class ReceiptCanvas {
  private readonly commands: DrawCommand[] = [];
  /** Ölçüm-only bağlam (build'den ÖNCE wrap/measureText için). */
  private readonly measure: SKRSContext2D;

  constructor() {
    ensureFonts();
    this.measure = createCanvas(RECEIPT_WIDTH, 8).getContext('2d');
  }

  /** Verilen font ile `text` genişliğini ölçer. */
  private widthOf(text: string, font: string): number {
    this.measure.font = font;
    return this.measure.measureText(text).width;
  }

  /** Verilen font/maxWidth ile satırlara böler. */
  private wrap(text: string, font: string, maxWidth: number): string[] {
    this.measure.font = font;
    return wrapToWidth((s) => this.measure.measureText(s).width, text, maxWidth);
  }

  /** Ortalanmış metin (uzunsa kaydırılır). Başlık/footer/seslenme için. */
  centered(text: string, opts: TextOptions): this {
    const font = fontString(opts.size, opts.bold ?? false);
    const lh = computeLineHeight(opts.size);
    const lines = this.wrap(sanitizeText(text), font, RECEIPT_WIDTH - PAD_X * 2);
    this.commands.push({
      height: lines.length * lh,
      draw: (ctx, top) => {
        ctx.font = font;
        lines.forEach((ln, i) => {
          const w = ctx.measureText(ln).width;
          ctx.fillText(ln, (RECEIPT_WIDTH - w) / 2, top + i * lh);
        });
      },
    });
    return this;
  }

  /** Sola dayalı metin (uzunsa kaydırılır). Meta + modifiye/not alt-satırları. */
  left(text: string, opts: TextOptions): this {
    const font = fontString(opts.size, opts.bold ?? false);
    const lh = computeLineHeight(opts.size);
    const indent = opts.indentPx ?? 0;
    const lines = this.wrap(sanitizeText(text), font, RECEIPT_WIDTH - PAD_X * 2 - indent);
    this.commands.push({
      height: lines.length * lh,
      draw: (ctx, top) => {
        ctx.font = font;
        lines.forEach((ln, i) => ctx.fillText(ln, PAD_X + indent, top + i * lh));
      },
    });
    return this;
  }

  /**
   * Sol metin + sağa-dayalı değer (fiyat/adet). Sol uzunsa kaydırılır, sağ
   * değer İLK satıra sağ-hizalı basılır. `measureText`-sağ-hiza.
   */
  leftRight(leftText: string, rightText: string, opts: TextOptions): this {
    const font = fontString(opts.size, opts.bold ?? false);
    const lh = computeLineHeight(opts.size);
    const right = sanitizeText(rightText);
    const rightW = this.widthOf(right, font);
    const maxLeft = RECEIPT_WIDTH - PAD_X * 2 - rightW - GAP;
    const leftLines = this.wrap(sanitizeText(leftText), font, Math.max(maxLeft, 1));
    this.commands.push({
      height: leftLines.length * lh,
      draw: (ctx, top) => {
        ctx.font = font;
        leftLines.forEach((ln, i) => ctx.fillText(ln, PAD_X, top + i * lh));
        ctx.fillText(right, RECEIPT_WIDTH - PAD_X - rightW, top);
      },
    });
    return this;
  }

  /**
   * Üç-kolon kalem satırı (Adisyo-parite): adet (sabit sol mini-kolon) · ad
   * (kalan genişlik, kaydırılır) · tutar (sağ-hizalı). Adet-kolonu adet
   * metnine göre uyarlanır ("2" dar / "5 Tam" geniş).
   */
  itemRow(qty: string, name: string, amount: string, opts: TextOptions): this {
    const font = fontString(opts.size, opts.bold ?? false);
    const lh = computeLineHeight(opts.size);
    const qtyText = sanitizeText(qty);
    const amountText = sanitizeText(amount);
    const qtyW = this.widthOf(qtyText, font);
    const amountW = this.widthOf(amountText, font);
    const qtyCol = Math.max(qtyW + 14, 40);
    const nameLeft = PAD_X + qtyCol;
    const nameMax = RECEIPT_WIDTH - PAD_X - amountW - GAP - nameLeft;
    const nameLines = this.wrap(sanitizeText(name), font, Math.max(nameMax, 1));
    this.commands.push({
      height: Math.max(nameLines.length, 1) * lh,
      draw: (ctx, top) => {
        ctx.font = font;
        ctx.fillText(qtyText, PAD_X, top);
        nameLines.forEach((ln, i) => ctx.fillText(ln, nameLeft, top + i * lh));
        ctx.fillText(amountText, RECEIPT_WIDTH - PAD_X - amountW, top);
      },
    });
    return this;
  }

  /** Yatay ayraç (blok sınırı). solid = düz çizgi, dashed = kesikli. */
  rule(style: RuleStyle = 'solid'): this {
    const height = 16;
    this.commands.push({
      height,
      draw: (ctx, top) => {
        const y = top + Math.floor(height / 2);
        if (style === 'solid') {
          ctx.fillRect(PAD_X, y, RECEIPT_WIDTH - PAD_X * 2, 2);
          return;
        }
        const dash = 8;
        const gap = 6;
        for (let x = PAD_X; x < RECEIPT_WIDTH - PAD_X; x += dash + gap) {
          const w = Math.min(dash, RECEIPT_WIDTH - PAD_X - x);
          ctx.fillRect(x, y, w, 2);
        }
      },
    });
    return this;
  }

  /** Dikey boşluk (blok arası nefes payı). */
  gap(px: number): this {
    this.commands.push({ height: Math.max(0, Math.round(px)), draw: () => undefined });
    return this;
  }

  /** İki-geçiş: yüksekliği topla → canvas aç → beyaz zemin → komutları çiz. */
  build(): Canvas {
    let contentH = 0;
    for (const c of this.commands) contentH += c.height;
    const totalH = PAD_TOP + contentH + PAD_BOTTOM;
    const canvas = createCanvas(RECEIPT_WIDTH, Math.max(totalH, 1));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, RECEIPT_WIDTH, canvas.height);
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    let top = PAD_TOP;
    for (const c of this.commands) {
      c.draw(ctx, top);
      top += c.height;
    }
    return canvas;
  }
}
