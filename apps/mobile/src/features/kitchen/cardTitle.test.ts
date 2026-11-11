import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { kitchenCardTitle, type TranslateFn } from './cardTitle';

/**
 * #790 — mutfak kartının başlığı.
 *
 * Çeviri sahte DEĞİL: gerçek `tr.json` okunur ve `{{x}}` yer tutucuları elle
 * doldurulur. Sebep, hatanın tam olarak **şablonda** yaşamasıydı
 * (`"{{area}} · Masa {{code}}"`), dallanmada değil: uydurma bir çeviriyle test
 * yeşil kalır ve şablona "Masa " geri eklenirse kimse fark etmez.
 */
const resources = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../i18n/locales/tr.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const t: TranslateFn = (key, params) => {
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      resources,
    );
  if (typeof value !== 'string') {
    throw new Error(`i18n anahtari yok veya string degil: ${key}`);
  }
  return Object.entries(params ?? {}).reduce(
    (text, [name, replacement]) =>
      text.replaceAll(`{{${name}}}`, replacement),
    value,
  );
};

describe('kitchenCardTitle', () => {
  it('bölgeli masada bölge + kanonik etiket basar, "Masa"yı İKİ KEZ yazmaz', () => {
    // Prod vakası (#790): BAHÇE'deki masanın display_no'su 1, snapshot "Masa 1".
    const title = kitchenCardTitle(
      {
        orderType: 'dine_in',
        tableCodeSnapshot: 'Masa 1',
        areaNameSnapshot: 'BAHÇE',
      },
      t,
    );
    expect(title).toBe('BAHÇE · Masa 1');
    expect(title).not.toMatch(/Masa\s+Masa/);
  });

  it('bölge adı masayı tekilleştirir: aynı display_no iki bölgede ayrışır', () => {
    // Prod'da DÖRT masa display_no=1 taşıyor; ayrımı yalnız bölge adı yapar.
    const bahce = kitchenCardTitle(
      {
        orderType: 'dine_in',
        tableCodeSnapshot: 'Masa 1',
        areaNameSnapshot: 'BAHÇE',
      },
      t,
    );
    const salon = kitchenCardTitle(
      {
        orderType: 'dine_in',
        tableCodeSnapshot: 'Masa 1',
        areaNameSnapshot: 'SALON',
      },
      t,
    );
    expect(bahce).not.toBe(salon);
  });

  it('bölgesiz masada snapshot olduğu gibi basılır (zaten ham kod)', () => {
    expect(
      kitchenCardTitle(
        {
          orderType: 'dine_in',
          tableCodeSnapshot: '36',
          areaNameSnapshot: null,
        },
        t,
      ),
    ).toBe('36');
  });

  it('paket siparişte masa etiketi yerine "Paket" basar', () => {
    expect(
      kitchenCardTitle(
        {
          orderType: 'takeaway',
          tableCodeSnapshot: null,
          areaNameSnapshot: null,
        },
        t,
      ),
    ).toBe(t('kitchen.takeaway'));
  });

  it('masası silinmiş masa siparişinde bilinmeyen-masa metnini basar', () => {
    expect(
      kitchenCardTitle(
        {
          orderType: 'dine_in',
          tableCodeSnapshot: null,
          areaNameSnapshot: 'SALON',
        },
        t,
      ),
    ).toBe(t('kitchen.tableUnknown'));
  });
});
