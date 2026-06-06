import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

/** Member PWA i18n (sv/nb/da/fi/en, invariant 6). English is the source; Nordic locales seeded. */
export const SUPPORTED_LOCALES = ['en', 'sv', 'nb', 'da', 'fi'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const en = {
  app: { title: 'Obikai', skipToContent: 'Skip to content', signOut: 'Sign out' },
  nav: { progress: 'My progress', invoices: 'My invoices' },
  login: {
    title: 'Sign in',
    email: 'Email',
    password: 'Password',
    submit: 'Sign in',
    error: 'Sign in failed. Check your email and password.',
  },
  progress: {
    title: 'My progress',
    notEnrolled: 'You are not enrolled in a discipline yet.',
    nextStep: 'Next step',
    topOfLadder: 'You are at the top of the ladder — congratulations!',
    loading: 'Loading…',
    error: 'Could not load your progress.',
    history: 'My promotions',
    noHistory: 'No promotions yet.',
    advisory: 'advisory',
    status: { ready: 'Ready to grade', close: 'Almost there', notYet: 'Keep training' },
  },
  invoices: {
    title: 'My invoices',
    number: 'Number',
    status: 'Status',
    total: 'Total',
    due: 'Due',
    empty: 'No invoices.',
    loading: 'Loading…',
    error: 'Could not load your invoices.',
  },
} as const;

const withSignOut = (label: string) => ({
  ...en,
  app: { ...en.app, signOut: label },
  login: { ...en.login },
});
const sv = {
  ...withSignOut('Logga ut'),
  login: { ...en.login, title: 'Logga in', submit: 'Logga in' },
};
const nb = {
  ...withSignOut('Logg ut'),
  login: { ...en.login, title: 'Logg inn', submit: 'Logg inn' },
};
const da = {
  ...withSignOut('Log ud'),
  login: { ...en.login, title: 'Log ind', submit: 'Log ind' },
};
const fi = {
  ...withSignOut('Kirjaudu ulos'),
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
