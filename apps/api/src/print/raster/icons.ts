/**
 * Fiş türü vektör ikonları — ADR-004 Amendment 10.
 *
 * Saf çizim fonksiyonları: `SKRSContext2D` + merkez koordinatı alır, yan etki
 * üretmez, ESC/POS baytı üretmez. `ReceiptCanvas.icon()` bunları çağırır.
 * Font/emoji BAĞIMSIZ (K5) — DejaVu Sans'ta emoji glyph'i yok + termal 1-bit
 * raster'da renkli emoji güvenilmez basmaz; canvas 2D primitifleriyle
 * (`arc`/`moveTo`/`lineTo`/`stroke`) çizilir.
 */

import type { SKRSContext2D } from '@napi-rs/canvas';

/** İptal fişi ikonu (K2) — çapraz iki kalın çizgi, ~60px çap. */
export function drawCancelIcon(ctx: SKRSContext2D, cx: number, cy: number): void {
  const r = 30;
  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r, cy - r);
  ctx.lineTo(cx + r, cy + r);
  ctx.moveTo(cx + r, cy - r);
  ctx.lineTo(cx - r, cy + r);
  ctx.stroke();
  ctx.restore();
}

/**
 * Paket mutfak fişi ikonu (K3) — basit çizgi-sanatı bisiklet: iki tekerlek
 * dairesi + kadraj/gidon/sele çizgileri, ~60px çap.
 */
export function drawTakeawayIcon(ctx: SKRSContext2D, cx: number, cy: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const rearX = -28;
  const frontX = 28;
  const wheelY = 18;
  const wheelR = 19;

  ctx.beginPath();
  ctx.arc(rearX, wheelY, wheelR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(frontX, wheelY, wheelR, 0, Math.PI * 2);
  ctx.stroke();

  const seatX = -8;
  const seatY = -12;
  const pedalX = 4;
  const pedalY = wheelY;
  const handleX = frontX;
  const handleY = -8;

  ctx.beginPath();
  ctx.moveTo(rearX, wheelY);
  ctx.lineTo(seatX, seatY);
  ctx.lineTo(pedalX, pedalY);
  ctx.lineTo(rearX, wheelY);
  ctx.moveTo(pedalX, pedalY);
  ctx.lineTo(frontX, wheelY);
  ctx.moveTo(seatX, seatY);
  ctx.lineTo(handleX, handleY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(seatX - 8, seatY - 4);
  ctx.lineTo(seatX + 6, seatY - 4);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(handleX - 9, handleY);
  ctx.lineTo(handleX + 9, handleY);
  ctx.stroke();

  ctx.restore();
}
