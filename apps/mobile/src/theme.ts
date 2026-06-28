/**
 * Design tokens for the waiter app (ADR-026 K3).
 *
 * Plain RN StyleSheet constants — no styling framework on mobile. Portrait,
 * light body, dark-slate accent. Touch targets use `minTouchTarget` (>= 44pt)
 * to satisfy the HCI checklist for finger-first POS use.
 */
export const colors = {
  slate: '#24333d',
  slateText: '#ffffff',
  background: '#ffffff',
  surface: '#f1f5f9',
  border: '#cbd5e1',
  textPrimary: '#111827',
  textSecondary: '#6b7280',
  danger: '#b91c1c',
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

/** Minimum interactive height/width in points (HCI checklist). */
export const minTouchTarget = 44;

/** Primary action button height (ADR-026 K3: >= 48px). */
export const buttonHeight = 52;

/** Text input height — slightly above minTouchTarget for comfortable tapping. */
export const inputHeight = 50;
