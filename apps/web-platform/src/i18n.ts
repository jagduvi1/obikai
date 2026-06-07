import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

/**
 * i18n scaffold for the platform console (invariant 6: sv/nb/da/fi/en from day one). English is the
 * source; Nordic locales start as copies and are translated as strings land.
 */
export const SUPPORTED_LOCALES = ['en', 'sv', 'nb', 'da', 'fi'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const en = {
  app: { title: 'Obikai Platform', skipToContent: 'Skip to content', signOut: 'Sign out' },
  nav: { tenants: 'Tenants', audit: 'Audit log', dashboard: 'Platform' },
  login: {
    title: 'Platform sign in',
    email: 'Email',
    password: 'Password',
    submit: 'Sign in',
    error: 'Sign in failed. Check your email and password.',
  },
  tenants: {
    title: 'Tenants',
    slug: 'Slug',
    name: 'Name',
    status: 'Status',
    created: 'Created',
    loading: 'Loading tenants…',
    empty: 'No tenants registered yet.',
    error: 'Could not load tenants — you may not have platform access.',
    view: 'View',
  },
  tenant: {
    back: 'Tenants',
    title: 'Tenant',
    slug: 'Slug',
    status: 'Status',
    created: 'Created',
    usage: 'Usage',
    members: 'Members',
    activeMembers: 'Active members',
    loading: 'Loading…',
    error: 'Could not load this tenant.',
  },
  audit: {
    title: 'Platform audit log',
    intro: 'Append-only, hash-chained record of cross-tenant platform reads.',
    when: 'When',
    actor: 'Actor',
    action: 'Action',
    target: 'Target',
    ip: 'IP',
    loading: 'Loading audit log…',
    empty: 'No platform activity recorded yet.',
    error: 'Could not load the audit log.',
  },
  statusValue: { active: 'Active', suspended: 'Suspended', archived: 'Archived' },
} as const;

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
