/**
 * Design tokens for the waiter app (ADR-026 K3).
 *
 * Plain RN StyleSheet constants — no styling framework on mobile. Portrait,
 * light body, dark-slate accent. Touch targets use `minTouchTarget` (>= 52pt,
 * docs/hci/pos-checklist.md "Dokunma hedefi") for finger-first POS use.
 */
export const colors = {
  slate: '#24333d',
  slateText: '#ffffff',
  background: '#ffffff',
  surface: '#f1f5f9',
  /** Quantity-stepper +/− button fill — a light grey that reads as a button on a white card (ADR-026 K2, reference parity). */
  control: '#e5e7eb',
  border: '#cbd5e1',
  textPrimary: '#111827',
  textSecondary: '#6b7280',
  danger: '#b91c1c',

  // Table card states (ADR-026 K2 — web colour-rule parity). Empty = white +
  // green dot; occupied = amber tint; open >= 60 min = red (danger) tint. All
  // hex collected here so screens never inline a literal colour (K3).
  /** Empty-table status dot (green). */
  available: '#16a34a',
  /** Occupied (< 60 min) card background — soft amber tint. */
  occupiedBg: '#fef3c7',
  /** Occupied card border / accent (amber). */
  occupiedText: '#b45309',
  /** Long-open (>= 60 min) card background — soft red tint (warning). */
  longOpenBg: '#fee2e2',
  /** Long-open card border / accent (red). */
  longOpenText: '#b91c1c',

  // ADR-026 Amendment 2 K3 — header bağlantı-durumu noktası (koyu slate
  // üstünde okunur parlaklıkta; ekranlar literal hex kullanmaz).
  /** Socket bağlı — yeşil durum noktası. */
  syncOnline: '#22c55e',
  /** Socket bağlanıyor / yeniden deniyor — amber durum noktası. */
  syncConnecting: '#f59e0b',
  /** Socket kopuk — kırmızı durum noktası. */
  syncOffline: '#ef4444',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  md: 12,
  lg: 16,
} as const;

/** Minimum interactive height/width in points (pos-checklist: 52×52pt). */
export const minTouchTarget = 52;

/** Primary action button height (ADR-026 K3: >= 48px). */
export const buttonHeight = 52;

/** Text input height — meets minTouchTarget (52pt). */
export const inputHeight = 52;
