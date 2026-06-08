import { type UiLocale, isUiLocale, matchUiLocale } from '@obikai/i18n';

/**
 * Browser glue for locale selection (the pure locale set + matcher live in @obikai/i18n). Resolves the
 * initial language from a saved preference → the browser's languages → English, persists the user's
 * choice, and reflects it on `<html lang>` for assistive tech and correct hyphenation (WCAG 3.1.1).
 */
const STORAGE_KEY = 'obikai.locale';
export const DEFAULT_UI_LOCALE: UiLocale = 'en';

function savedLocale(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return ''; // storage can be blocked (private mode / disabled cookies)
  }
}

function browserLocales(): string[] {
  if (typeof navigator === 'undefined') return [];
  return [...(navigator.languages ?? (navigator.language ? [navigator.language] : []))];
}

/** A saved preference wins; else the browser's best match; else English. */
export function loadInitialLocale(): UiLocale {
  return matchUiLocale([savedLocale(), ...browserLocales()]) ?? DEFAULT_UI_LOCALE;
}

export function persistLocale(locale: string): void {
  if (!isUiLocale(locale)) return;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore — persistence is best-effort
  }
}

/** Reflect the active locale on the document element (H3 / WCAG 3.1.1). No-op outside the browser. */
export function applyDocumentLang(locale: string): void {
  if (typeof document !== 'undefined' && isUiLocale(locale)) {
    document.documentElement.lang = locale;
  }
}
