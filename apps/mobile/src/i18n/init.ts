import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import tr from './locales/tr.json';

/**
 * Mobile i18n bootstrap (ADR-025 K9).
 *
 * MVP: TR-only, same key convention as apps/web (`t('app.title')`). No browser
 * language detector here — React Native has no `navigator.language`; the waiter
 * app is Turkish-only so we pin `lng: 'tr'`. EN locale is v5.1 backlog.
 */
void i18n.use(initReactI18next).init({
  resources: { tr: { translation: tr } },
  lng: 'tr',
  fallbackLng: 'tr',
  supportedLngs: ['tr'],
  defaultNS: 'translation',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
