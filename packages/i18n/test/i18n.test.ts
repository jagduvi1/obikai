import { DEFAULT_LOCALE, type LocalizedString } from '@obikai/domain';
import { describe, expect, it } from 'vitest';
import { makeFormatters, resolveLocalized, t } from '../src/index.js';
import { localizedAppError } from '../src/index.js';

/** Intl currency output uses locale-specific (often non-breaking) spaces and digit grouping that
 * vary by ICU version. We normalize whitespace and assert on the load-bearing parts: the amount,
 * the decimal separator, and the currency token. */
const normalize = (s: string): string => s.replace(/\s/g, ' ');

describe('makeFormatters.money', () => {
  it('formats SEK from integer minor units (divides by 100)', () => {
    const fmt = makeFormatters({ locale: 'sv', currency: 'SEK' });
    const out = normalize(fmt.money(123_45));
    // Swedish uses a comma decimal separator and the "kr" symbol.
    expect(out).toContain('123');
    expect(out).toContain('45');
    expect(out).toContain(',');
    expect(out.toLowerCase()).toContain('kr');
  });

  it('formats EUR from integer minor units in an English locale', () => {
    const fmt = makeFormatters({ locale: 'en', currency: 'EUR' });
    const out = normalize(fmt.money(9_99));
    expect(out).toContain('9.99');
    expect(out).toContain('€');
  });

  it('renders zero and exact whole amounts', () => {
    const fmt = makeFormatters({ locale: 'en', currency: 'EUR' });
    expect(normalize(fmt.money(0))).toContain('0.00');
    expect(normalize(fmt.money(100))).toContain('1.00');
  });
});

describe('resolveLocalized fallback', () => {
  const value: LocalizedString = { sv: 'Hej', en: 'Hello' };

  it('returns the requested locale when present', () => {
    expect(resolveLocalized(value, { requested: 'sv', defaultLocale: 'en' })).toBe('Hej');
  });

  it('falls back to the tenant default when the requested locale is missing', () => {
    expect(resolveLocalized(value, { requested: 'fi', defaultLocale: 'sv' })).toBe('Hej');
  });

  it('falls back to the platform default locale, then to any present locale', () => {
    expect(resolveLocalized(value, { requested: 'fi', defaultLocale: 'nb' })).toBe('Hello');
    expect(DEFAULT_LOCALE).toBe('en');
    const only: LocalizedString = { da: 'Hej da' };
    expect(resolveLocalized(only, { requested: 'fi', defaultLocale: 'nb' })).toBe('Hej da');
  });

  it('returns undefined for an absent value', () => {
    expect(resolveLocalized(undefined, { requested: 'en', defaultLocale: 'sv' })).toBeUndefined();
  });
});

describe('t interpolator', () => {
  const catalog = { 'greeting.welcome': 'Welcome, {name}', 'app.name': 'Obikai' };

  it('substitutes {var} placeholders', () => {
    expect(t(catalog, 'greeting.welcome', { name: 'Mira' })).toBe('Welcome, Mira');
  });

  it('returns the key itself for a missing entry', () => {
    expect(t(catalog, 'missing.key')).toBe('missing.key');
  });

  it('leaves unmatched placeholders intact', () => {
    expect(t(catalog, 'greeting.welcome')).toBe('Welcome, {name}');
  });
});

describe('localizedAppError', () => {
  it('omits vars when none are given (exactOptionalPropertyTypes-safe)', () => {
    const e = localizedAppError('AUTH_INVALID_CREDENTIALS', { ns: 'auth', key: 'invalid' }, 401);
    expect(e.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(e.httpStatus).toBe(401);
    expect('vars' in e.i18n).toBe(false);
  });

  it('carries vars when supplied', () => {
    const e = localizedAppError(
      'BILLING_OVERDUE',
      { ns: 'billing', key: 'overdue', vars: { days: 5 } },
      402,
    );
    expect(e.i18n.vars).toEqual({ days: 5 });
  });
});
