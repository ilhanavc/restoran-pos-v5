import type { AuditEventType } from '@restoran-pos/shared-types';
import { DENY_LIST } from './deny-list.js';
import { ALLOWED_KEYS } from './allowed-keys.js';
import type { AllowedPayload } from './types.js';

// Lowercase for case-insensitive deny matching ('Phone', 'EMAIL', 'Telefon' all caught)
const DENY_SET: ReadonlySet<string> = new Set(DENY_LIST.map((k) => k.toLowerCase()));

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isDenied(key: string): boolean {
  return DENY_SET.has(key.toLowerCase());
}

/**
 * Recursively scan arrays (and objects within them) for deny-list key hits.
 * Throws immediately on first match. Does NOT apply whitelist — caller already
 * confirmed the containing key is allowed; this is a pure PII sweep.
 */
function scanForDenyList(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      scanForDenyList(item);
    }
  } else if (isPlainRecord(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (isDenied(key)) throw new Error('error.audit.piiDetected');
      scanForDenyList(nested);
    }
  }
}

/**
 * ADR-003 §12 — recursive whitelist filter for audit payloads.
 *
 * Behavior:
 *  1. DENY_LIST hit (case-insensitive) → throw new Error('error.audit.piiDetected')
 *  2. Not in event's ALLOWED_KEYS → drop with console.warn (whitelist-miss)
 *  3. Allowed key whose value is a plain object → recurse with SAME allow-list scope
 *  4. Allowed key whose value is an array → scan array items for deny-list hits
 *
 * Pure function: zero I/O, zero DB dependency.
 */
function sanitizeRecord(
  eventType: AuditEventType,
  raw: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(raw)) {
    if (isDenied(key)) {
      throw new Error('error.audit.piiDetected');
    }

    if (!allowedKeys.has(key)) {
      // whitelist-miss: drop and continue (English log per code-style rule)
      console.warn(
        `[audit.sanitizer] dropped non-whitelisted key '${key}' for event '${eventType}'`,
      );
      continue;
    }

    const value = raw[key];

    if (isPlainRecord(value)) {
      // Nested object: recurse with same allowed set
      out[key] = sanitizeRecord(eventType, value, allowedKeys);
      continue;
    }

    if (Array.isArray(value)) {
      // Array: sweep entire tree for deny-list hits, then keep as-is
      scanForDenyList(value);
    }

    out[key] = value;
  }

  return out;
}

export function sanitize<T extends AuditEventType>(
  eventType: T,
  rawPayload: Record<string, unknown>,
): AllowedPayload<T> {
  const allowed = ALLOWED_KEYS[eventType];
  const allowedSet: ReadonlySet<string> = new Set(allowed);
  const sanitized = sanitizeRecord(eventType, rawPayload, allowedSet);
  return sanitized as AllowedPayload<T>;
}
