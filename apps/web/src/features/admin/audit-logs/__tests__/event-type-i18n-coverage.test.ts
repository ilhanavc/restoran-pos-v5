import { describe, expect, it } from 'vitest';
import { AuditEventTypeSchema } from '@restoran-pos/shared-types';
import tr from '../../../../i18n/locales/tr.json';
import { eventTypeI18nKey } from '../labels';

/**
 * ADR-037 K9 — **i18n drift kilidi (kritik)**.
 *
 * `AuditEventTypeSchema.options` üzerinde döner ve HER değer için `tr.json`'da
 * `audit.eventType.*` karşılığı olduğunu doğrular. Yeni bir `writeAudit` olayı
 * eklenip çevirisi unutulursa **CI kırılır**.
 *
 * Gerekçe: ADR-024 "üçlü kontrat"ın sessiz-boşalma dersi (S104) ve
 * `feedback_adr_sibling_drift` — paylaşılan tablo bir yerde güncellenip
 * diğerinde unutuluyor, hafta sonra canlı bug çıkıyor. Bu test o tuzağı
 * yapısal olarak kapatır (kod incelemesine güvenmez).
 *
 * NOT: ekranın çalışma-zamanı davranışı yine de **fallback**'lidir (ham teknik
 * string basılır, asla boş) — bu test o güvenlik ağının gerekmemesini sağlar.
 */

const labels = (tr as { audit: { eventType: Record<string, string> } }).audit
  .eventType;

describe('ADR-037 K9 — audit olay türü i18n kapsaması', () => {
  it.each(AuditEventTypeSchema.options)(
    '%s için tr.json karşılığı var',
    (eventType) => {
      const key = eventTypeI18nKey(eventType);
      const leaf = key.replace('audit.eventType.', '');
      const value = labels[leaf];
      expect(
        value,
        `tr.json'da "${key}" eksik — yeni audit olayı eklendiyse Türkçe etiketini de ekleyin.`,
      ).toBeDefined();
      expect(value?.trim().length ?? 0).toBeGreaterThan(0);
    },
  );

  it('anahtar deseni: nokta yerine alt çizgi', () => {
    expect(eventTypeI18nKey('order_item.updated')).toBe(
      'audit.eventType.order_item_updated',
    );
  });

  it('tr.json fazladan/ölü olay etiketi taşımaz (ters yönde drift)', () => {
    const known = new Set(
      AuditEventTypeSchema.options.map((e) => e.replace(/\./g, '_')),
    );
    const orphans = Object.keys(labels).filter((k) => !known.has(k));
    expect(orphans).toEqual([]);
  });
});
