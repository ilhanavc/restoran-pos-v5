import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import tr from './locales/tr.json';

/**
 * MVP: TR-only. Fallback chain stays on TR so missing keys still render Turkish.
 * EN locale is v5.1 backlog (ADR-011 §14).
 */
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { tr: { translation: tr } },
    lng: 'tr',
    fallbackLng: 'tr',
    supportedLngs: ['tr'],
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    returnNull: false,
  });

export default i18n;
