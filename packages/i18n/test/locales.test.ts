import { describe, expect, it } from 'vitest';
import { UI_LOCALES, UI_LOCALE_NATIVE_NAMES, isUiLocale, matchUiLocale } from '../src/index.js';

describe('UI locale metadata', () => {
  it('has a native name for every supported locale', () => {
    for (const locale of UI_LOCALES) {
      expect(UI_LOCALE_NATIVE_NAMES[locale]).toBeTruthy();
    }
    expect(UI_LOCALES[0]).toBe('en'); // English is the source locale
  });

  it('narrows supported locales and rejects others', () => {
    expect(isUiLocale('sv')).toBe(true);
    expect(isUiLocale('de')).toBe(false);
    expect(isUiLocale('SV')).toBe(false); // case-sensitive: callers lowercase first
  });
});

describe('matchUiLocale', () => {
  it('matches an exact supported tag', () => {
    expect(matchUiLocale(['sv'])).toBe('sv');
  });

  it('falls back from a region tag to its base language (sv-SE → sv)', () => {
    expect(matchUiLocale(['sv-SE'])).toBe('sv');
    expect(matchUiLocale(['NB-NO'])).toBe('nb'); // case-insensitive
  });

  it('honours candidate order — first match wins', () => {
    expect(matchUiLocale(['xx', 'da-DK', 'sv'])).toBe('da');
  });

  it('skips empty/unknown candidates and returns null when nothing matches', () => {
    expect(matchUiLocale(['', 'de', 'fr-FR'])).toBeNull();
    expect(matchUiLocale([])).toBeNull();
  });
});
