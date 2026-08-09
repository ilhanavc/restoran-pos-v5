import type { TFunction } from 'i18next';
import { AuditEventTypeSchema } from '@restoran-pos/shared-types';

/**
 * ADR-037 K9 — olay/nesne etiketleme.
 *
 * Anahtar deseni: `audit.eventType.<event_type nokta yerine alt_çizgi>`
 * (`order_item.updated` ⇒ `audit.eventType.order_item_updated`).
 *
 * **Fallback yazılıdır:** karşılık bulunamazsa **ham teknik string** basılır —
 * asla boş, asla ham i18n key. Denetim ekranı hiçbir koşulda bilgi düşürmez.
 * (Bu, enum'dan çıkarılmış eski bir olay için de geçerlidir.)
 *
 * Kapsama testi (`__tests__/event-type-i18n-coverage.test.ts`) her enum değeri
 * için tr karşılığı olduğunu doğrular; yeni bir `writeAudit` olayı eklenip
 * çevirisi unutulursa CI kırılır.
 */

/** `order_item.updated` → `order_item_updated` */
export function eventTypeI18nKey(eventType: string): string {
  return `audit.eventType.${eventType.replace(/\./g, '_')}`;
}

export function eventTypeLabel(t: TFunction, eventType: string): string {
  return t(eventTypeI18nKey(eventType), { defaultValue: eventType });
}

export function entityTypeLabel(t: TFunction, entityType: string): string {
  return t(`audit.entityType.${entityType}`, { defaultValue: entityType });
}

export function roleLabel(t: TFunction, role: string): string {
  return t(`audit.role.${role}`, { defaultValue: role });
}

/** Filtre çubuğundaki çoklu seçim grupları (K7). */
export type AuditEventGroupId =
  | 'order'
  | 'payment'
  | 'user'
  | 'printer'
  | 'system';

const GROUP_ORDER: readonly AuditEventGroupId[] = [
  'order',
  'payment',
  'user',
  'printer',
  'system',
];

/** Olay kodunun namespace'inden grup türetilir — elle liste tutulmaz (drift yok). */
function groupOf(eventType: string): AuditEventGroupId {
  if (eventType.startsWith('order') || eventType.startsWith('table')) {
    return 'order';
  }
  if (eventType.startsWith('payment')) return 'payment';
  if (eventType.startsWith('user') || eventType.startsWith('auth')) {
    return 'user';
  }
  if (eventType.startsWith('printer')) return 'printer';
  return 'system';
}

export interface AuditEventGroup {
  id: AuditEventGroupId;
  eventTypes: string[];
}

/**
 * Enum'un TAMAMI gruplanır — hiçbir olay filtre listesinden düşmez
 * (yeni olay eklendiğinde otomatik `system` grubuna girer, görünmez olmaz).
 */
export function groupedEventTypes(): AuditEventGroup[] {
  const buckets = new Map<AuditEventGroupId, string[]>(
    GROUP_ORDER.map((g) => [g, [] as string[]]),
  );
  for (const eventType of AuditEventTypeSchema.options) {
    buckets.get(groupOf(eventType))!.push(eventType);
  }
  return GROUP_ORDER.map((id) => ({ id, eventTypes: buckets.get(id)! })).filter(
    (g) => g.eventTypes.length > 0,
  );
}
