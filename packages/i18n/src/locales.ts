/**
 * Canonical UI locale set (invariant 6: sv/nb/da/fi/en from day one) + native display names and a
 * pure best-match resolver. Lives in the framework-free i18n layer so every SPA agrees on ONE source
 * of truth (no per-app drift) and the api can reference the same set. No DOM here — browsers add the
 * localStorage / `document.lang` glue in their own `locale.ts`.
 */

/** The UI languages the product ships, English first (the source locale). */
export const UI_LOCALES = ['en', 'sv', 'nb', 'da', 'fi'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

/** Endonyms (each language's own name) for a self-describing language switcher. */
export const UI_LOCALE_NATIVE_NAMES: Record<UiLocale, string> = {
  en: 'English',
  sv: 'Svenska',
  nb: 'Norsk bokmål',
  da: 'Dansk',
  fi: 'Suomi',
};

const SUPPORTED = new Set<string>(UI_LOCALES);

/** Narrow an arbitrary string to a supported UI locale. */
export function isUiLocale(value: string): value is UiLocale {
  return SUPPORTED.has(value);
}

/**
 * Pick the best supported UI locale from ordered `candidates` (e.g. a saved preference followed by
 * `navigator.languages`). Matches an exact tag first, then its base language (`sv-SE` → `sv`).
 * Returns null when nothing matches, so the caller owns the default.
 */
export function matchUiLocale(candidates: readonly string[]): UiLocale | null {
  for (const raw of candidates) {
    if (!raw) continue;
    const tag = raw.toLowerCase();
    if (isUiLocale(tag)) return tag;
    const base = tag.split('-', 1)[0];
    if (base !== undefined && isUiLocale(base)) return base;
  }
  return null;
}
