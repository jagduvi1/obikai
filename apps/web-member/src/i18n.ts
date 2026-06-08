import { UI_LOCALES } from '@obikai/i18n';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { applyDocumentLang, loadInitialLocale, persistLocale } from './locale';

/** Member PWA i18n (sv/nb/da/fi/en, invariant 6). English is the source; Nordic locales seeded. The
 *  supported set is the single source of truth in @obikai/i18n. */
export const SUPPORTED_LOCALES = UI_LOCALES;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const en = {
  app: {
    title: 'Obikai',
    skipToContent: 'Skip to content',
    signOut: 'Sign out',
    language: 'Language',
  },
  nav: { progress: 'My progress', invoices: 'My invoices', waivers: 'Waivers' },
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
    inviteTitle: 'Set up your account',
    inviteIntro: 'Choose a password to finish setting up your member account.',
    acceptSubmit: 'Create my account',
    inviteError: 'This invite is invalid or has expired. Ask your dojo for a new one.',
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
  waivers: {
    title: 'Waivers',
    intro: 'Read each waiver and sign it digitally. Your signature is dated and kept as a record.',
    loading: 'Loading…',
    error: 'Could not load your waivers.',
    actionNeeded: 'Needs your signature',
    none: 'There are no waivers to sign right now.',
    allSigned: 'You have signed all current waivers. Thank you!',
    version: 'Version {{version}}',
    signedOn: 'Signed {{date}}',
    signedBy: 'Signed by {{name}}',
    fullName: 'Your full name',
    fullNameHelp: 'Type your full legal name to sign.',
    agree: 'I have read and agree to this waiver.',
    sign: 'Sign waiver',
    signing: 'Signing…',
    signError: 'Could not record your signature. Please try again.',
    signedSection: 'Signed waivers',
    mustAgree: 'Please confirm you have read and agree.',
    mustName: 'Please type your full name to sign.',
  },
} as const;

const withSignOut = (label: string) => ({
  ...en,
  app: { ...en.app, signOut: label },
  login: { ...en.login },
});
const sv = {
  ...withSignOut('Logga ut'),
  app: { ...en.app, signOut: 'Logga ut', language: 'Språk' },
  nav: { ...en.nav, progress: 'Mina framsteg', invoices: 'Mina fakturor', waivers: 'Avtal' },
  progress: {
    title: 'Mina framsteg',
    notEnrolled: 'Du är inte inskriven i någon disciplin ännu.',
    nextStep: 'Nästa steg',
    topOfLadder: 'Du är högst upp på stegen — grattis!',
    loading: 'Läser in…',
    error: 'Kunde inte läsa in dina framsteg.',
    history: 'Mina graderingar',
    noHistory: 'Inga graderingar ännu.',
    advisory: 'rekommenderat',
    status: { ready: 'Redo att graderas', close: 'Nästan där', notYet: 'Fortsätt träna' },
  },
  invoices: {
    title: 'Mina fakturor',
    number: 'Nummer',
    status: 'Status',
    total: 'Totalt',
    due: 'Förfaller',
    empty: 'Inga fakturor.',
    loading: 'Läser in…',
    error: 'Kunde inte läsa in dina fakturor.',
  },
  waivers: {
    ...en.waivers,
    title: 'Avtal',
    intro:
      'Läs varje avtal och signera det digitalt. Din signatur dateras och sparas som underlag.',
    error: 'Kunde inte läsa in dina avtal.',
    actionNeeded: 'Behöver din signatur',
    none: 'Det finns inga avtal att signera just nu.',
    allSigned: 'Du har signerat alla aktuella avtal. Tack!',
    version: 'Version {{version}}',
    signedOn: 'Signerat {{date}}',
    signedBy: 'Signerat av {{name}}',
    fullName: 'Ditt fullständiga namn',
    fullNameHelp: 'Skriv ditt fullständiga namn för att signera.',
    agree: 'Jag har läst och godkänner detta avtal.',
    sign: 'Signera avtal',
    signing: 'Signerar…',
    signError: 'Kunde inte registrera din signatur. Försök igen.',
    signedSection: 'Signerade avtal',
    mustAgree: 'Bekräfta att du har läst och godkänner.',
    mustName: 'Skriv ditt fullständiga namn för att signera.',
  },
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
    inviteTitle: 'Skapa ditt konto',
    inviteIntro: 'Välj ett lösenord för att slutföra registreringen av ditt medlemskonto.',
    acceptSubmit: 'Skapa mitt konto',
    inviteError: 'Inbjudan är ogiltig eller har gått ut. Be din klubb om en ny.',
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

const initialLocale = loadInitialLocale();

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    sv: { translation: sv },
    nb: { translation: nb },
    da: { translation: da },
    fi: { translation: fi },
  },
  lng: initialLocale,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// Reflect the active locale on <html lang> now and on every switch, and remember the user's choice.
applyDocumentLang(initialLocale);
i18n.on('languageChanged', (lng: string) => {
  persistLocale(lng);
  applyDocumentLang(lng);
});

export default i18n;
