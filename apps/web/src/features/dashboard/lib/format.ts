/**
 * Para birimi formatı: kuruş integer → "₺123,45".
 * tr-TR locale; v3 paritesi (virgül ondalık ayraç, nokta binlik).
 */
export function formatTryFromCents(cents: number): string {
  const tl = cents / 100;
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(tl);
}

/** "₺1,2K" / "₺850" — kompakt notation, chart eksenleri için. */
export function formatTryCompact(cents: number): string {
  const tl = cents / 100;
  if (tl >= 1000) {
    return `₺${(tl / 1000).toFixed(1).replace('.', ',')}K`;
  }
  return `₺${Math.round(tl)}`;
}

/** ISO datetime → "HH:mm" tr-TR. */
export function formatTimeHm(iso: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
