import { Temporal } from '@js-temporal/polyfill';
import type { Instant } from '@obikai/domain';

/**
 * Deterministic, timezone-explicit date math (ADR-0005). Everything takes an injected `Instant`
 * and an explicit IANA `zone` — never the ambient clock or the viewer's locale — so calendar
 * thresholds (e.g. "6 months at blue belt") are reproducible across machines and DST boundaries.
 */

function toPlainDate(i: Instant, zone: string): Temporal.PlainDate {
  return Temporal.Instant.fromEpochMilliseconds(i.epochMs).toZonedDateTimeISO(zone).toPlainDate();
}

export function ageYears(dob: Instant, now: Instant, zone: string): number {
  return toPlainDate(dob, zone).until(toPlainDate(now, zone), { largestUnit: 'years' }).years;
}

export function timeThresholdReached(
  entered: Instant,
  now: Instant,
  zone: string,
  months: number,
  days: number,
): { met: boolean; currentDays: number; targetDays: number } {
  const enteredDate = toPlainDate(entered, zone);
  const nowDate = toPlainDate(now, zone);
  const threshold = enteredDate.add({ months, days });
  const met = Temporal.PlainDate.compare(nowDate, threshold) >= 0;
  const currentDays = Math.max(0, enteredDate.until(nowDate, { largestUnit: 'days' }).days);
  const targetDays = enteredDate.until(threshold, { largestUnit: 'days' }).days;
  return { met, currentDays, targetDays };
}
