/**
 * Locale-aware formatters built on the platform `Intl` APIs only — zero runtime deps.
 *
 * The two i18n axes (ADR via @obikai/i18n) meet here: CURRENCY is a property of the money/tenant
 * (`ctx.currency`), while date/number presentation follows the VIEWER (`ctx.locale`). `money` takes
 * integer minor units (öre/cents, see @obikai/domain Money) and divides by 100 for display.
 */
import type { Currency, Locale } from '@obikai/domain';

export interface FormatterContext {
  /** The viewer's locale — governs date/number digit grouping, separators, etc. */
  readonly locale: Locale;
  /** The tenant's currency — a property of the money, never of the viewer. */
  readonly currency: Currency;
  /** IANA zone (e.g. 'Europe/Stockholm'); omit to use the runtime default zone. */
  readonly timeZone?: string;
}

export interface Formatters {
  /** Format a calendar date/time in the viewer's locale (and pinned zone, if given). */
  date(d: Date): string;
  /** Format a plain number in the viewer's locale. */
  number(n: number): string;
  /** Format integer minor units as currency (divides by 100) in the tenant's currency. */
  money(minorUnits: number): string;
}

/**
 * Build a small bundle of `Intl`-backed formatters bound to one viewer/tenant context. The
 * underlying `Intl.*Format` instances are created once and reused, so formatting many values is
 * cheap. Pure aside from reading the host ICU data — no I/O, no ambient clock.
 */
export function makeFormatters(ctx: FormatterContext): Formatters {
  const dateOptions: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(ctx.timeZone !== undefined ? { timeZone: ctx.timeZone } : {}),
  };
  const dateFmt = new Intl.DateTimeFormat(ctx.locale, dateOptions);
  const numberFmt = new Intl.NumberFormat(ctx.locale);
  const moneyFmt = new Intl.NumberFormat(ctx.locale, {
    style: 'currency',
    currency: ctx.currency,
  });

  return {
    date: (d: Date) => dateFmt.format(d),
    number: (n: number) => numberFmt.format(n),
    money: (minorUnits: number) => moneyFmt.format(minorUnits / 100),
  };
}
