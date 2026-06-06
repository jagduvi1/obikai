import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

/**
 * i18n scaffold (invariant 6: sv/nb/da/fi/en from day one). English is the source; the Nordic
 * locales start as copies and are translated as strings land. Locale-aware dates/numbers/currency
 * use the platform Intl APIs against the active language. Keys are namespaced by area.
 */
export const SUPPORTED_LOCALES = ['en', 'sv', 'nb', 'da', 'fi'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const en = {
  app: { title: 'Obikai Admin', skipToContent: 'Skip to content', signOut: 'Sign out' },
  nav: { members: 'Members', dashboard: 'Dashboard' },
  login: {
    title: 'Sign in',
    email: 'Email',
    password: 'Password',
    submit: 'Sign in',
    error: 'Sign in failed. Check your email and password.',
  },
  members: {
    title: 'Members',
    name: 'Name',
    email: 'Email',
    status: 'Status',
    empty: 'No members yet.',
    loading: 'Loading members…',
    error: 'Could not load members.',
  },
} as const;

// Nordic locales begin as English copies (translated incrementally); only a few keys differ today.
const sv = {
  ...en,
  app: { ...en.app, signOut: 'Logga ut' },
  login: { ...en.login, title: 'Logga in', submit: 'Logga in' },
};
const nb = {
  ...en,
  app: { ...en.app, signOut: 'Logg ut' },
  login: { ...en.login, title: 'Logg inn', submit: 'Logg inn' },
};
const da = {
  ...en,
  app: { ...en.app, signOut: 'Log ud' },
  login: { ...en.login, title: 'Log ind', submit: 'Log ind' },
};
const fi = {
  ...en,
  app: { ...en.app, signOut: 'Kirjaudu ulos' },
  login: { ...en.login, title: 'Kirjaudu', submit: 'Kirjaudu' },
};

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    sv: { translation: sv },
    nb: { translation: nb },
    da: { translation: da },
    fi: { translation: fi },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
