/**
 * Design tokens for the waiter app (ADR-026 K3).
 *
 * Plain RN StyleSheet constants — no styling framework on mobile. Portrait,
 * light body, dark-slate shell + single violet accent (ADR-026 Amendment 4).
 * Touch targets use `minTouchTarget` (>= 52pt,
 * docs/hci/pos-checklist.md "Dokunma hedefi") for finger-first POS use.
 */
export const colors = {
  slate: '#24333d',
  slateText: '#ffffff',
  /**
   * Single brand accent (ADR-026 Amendment 4 K2) — the web violet `#6C63FF`
   * family, darkened so white label text clears WCAG AA. Used for the selected
   * category chip fill, the active region pill, and primary action buttons. The
   * dark-slate shell (headers) and the pastel table-status colours are NOT
   * accented (K2). Web `#6C63FF` on white is only ~4.32:1, below the 4.5 AA
   * threshold (K7), so it is darkened here.
   */
  // #584DE0 on white text: 5.91:1 (WCAG AA >= 4.5)
  accent: '#584DE0',
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
  /** Socket kopuk — kırmızı durum noktası (hci-gate: koyu slate üstünde
   * kontrast marjı için #ef4444 yerine daha parlak ton, ~4.5:1). */
  syncOffline: '#f87171',
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

/**
 * Typography scale (ADR-026 Amendment 4 K1). A pragmatic fontSize ramp matching
 * the app's existing usage clusters plus a weight convention. Components that
 * this Amendment touches bind their hardcoded sizes to these tokens; untouched
 * screens are left as-is (surgical — CLAUDE.md core-directive 7). Off-scale
 * legacy sizes (12/14/16/18) stay literal until their screen is next revisited.
 */
export const typography = {
  fontSize: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 27,
  },
  weight: {
    regular: '400',
    semibold: '600',
    bold: '700',
  },
} as const;

/**
 * Soft card elevation (ADR-026 Amendment 4 K1) — web `--shadow-soft` parity,
 * sourced from the existing TableCard pattern. Spread into a card's style to get
 * an iOS shadow + an Android `elevation`. Applied to ProductCard and the
 * category chips (K3); bottom-sheets are excluded (already full-width).
 */
export const shadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.08,
  shadowRadius: 4,
  elevation: 2,
} as const;

/** Minimum interactive height/width in points (pos-checklist: 52×52pt). */
export const minTouchTarget = 52;

/** Primary action button height (ADR-026 K3: >= 48px). */
export const buttonHeight = 52;

/** Text input height — meets minTouchTarget (52pt). */
export const inputHeight = 52;
