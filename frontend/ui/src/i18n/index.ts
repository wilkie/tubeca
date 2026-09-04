import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import { pseudoLocale } from './pseudo';

const resources = {
  en: { translation: en },
  // Generated from the English strings; see pseudo.ts for what it is for.
  'en-XA': { translation: pseudoLocale(en) },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      // `?lng=` first, so the pseudo-locale can be tried without changing
      // anything that persists.
      order: ['querystring', 'localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;
