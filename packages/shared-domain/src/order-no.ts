export function formatOrderNo(no: number): string {
  if (!Number.isInteger(no) || no < 1) throw new RangeError('Order number must be positive integer');
  return `#${String(no).padStart(4, '0')}`;
}

export function parseOrderNo(formatted: string): number {
  const match = /^#(\d+)$/.exec(formatted);
  if (match === null || match[1] === undefined) {
    throw new TypeError(`parseOrderNo: invalid format "${formatted}"`);
  }
  const value = parseInt(match[1], 10);
  if (value < 1) throw new RangeError('Order number must be positive');
  return value;
}
