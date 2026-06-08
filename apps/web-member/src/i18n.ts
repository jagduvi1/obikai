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
    forgot: 'Forgot your password?',
  },
  auth: {
    forgotTitle: 'Reset your password',
    forgotIntro: 'Enter your email and we’ll send you a reset link.',
    emailLabel: 'Email',
    sendResetLink: 'Send reset link',
    resetSent: 'If that email is registered, a reset link is on its way. Check your inbox.',
    backToLogin: 'Back to sign in',
    resetTitle: 'Choose a new password',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    setPassword: 'Set new password',
    resetDone: 'Your password has been changed. You can now sign in.',
    resetError: 'This reset link is invalid or has expired. Request a new one.',
    mismatch: 'The passwords do not match.',
    tooShort: 'Password must be at least 12 characters.',
    missingToken: 'This link is missing its token. Request a new email.',
    verifyTitle: 'Confirm your email',
    verifying: 'Confirming your email…',
    verifyDone: 'Your email is confirmed. Thank you!',
    verifyError: 'This confirmation link is invalid or has expired.',
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
  login: { ...en.login, title: 'Logga in', submit: 'Logga in', forgot: 'Glömt ditt lösenord?' },
  auth: {
    ...en.auth,
    forgotTitle: 'Återställ ditt lösenord',
    forgotIntro: 'Ange din e-postadress så skickar vi en återställningslänk.',
    emailLabel: 'E-post',
    sendResetLink: 'Skicka återställningslänk',
    resetSent:
      'Om e-postadressen finns registrerad är en återställningslänk på väg. Kolla din inkorg.',
    backToLogin: 'Tillbaka till inloggning',
    resetTitle: 'Välj ett nytt lösenord',
    newPassword: 'Nytt lösenord',
    confirmPassword: 'Bekräfta nytt lösenord',
    setPassword: 'Spara nytt lösenord',
    resetDone: 'Ditt lösenord har ändrats. Du kan nu logga in.',
    resetError: 'Återställningslänken är ogiltig eller har gått ut. Begär en ny.',
    mismatch: 'Lösenorden matchar inte.',
    tooShort: 'Lösenordet måste vara minst 12 tecken.',
    missingToken: 'Länken saknar sin token. Begär ett nytt e-postmeddelande.',
    verifyTitle: 'Bekräfta din e-postadress',
    verifying: 'Bekräftar din e-postadress…',
    verifyDone: 'Din e-postadress är bekräftad. Tack!',
    verifyError: 'Bekräftelselänken är ogiltig eller har gått ut.',
  },
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
