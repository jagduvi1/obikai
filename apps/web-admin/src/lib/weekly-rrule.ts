/**
 * Minimal weekly-RRULE helper for the schedule builder. Dojo classes are overwhelmingly weekly on a
 * fixed set of weekdays, so the admin UI composes a `FREQ=WEEKLY;BYDAY=…` rule from weekday toggles
 * rather than asking owners to hand-write iCal RRULE strings. The api still accepts any RRULE; this
 * just covers the common case ergonomically (ADR-0014).
 */
export const WEEKDAYS = [
  { code: 'MO', labelKey: 'mon' },
  { code: 'TU', labelKey: 'tue' },
  { code: 'WE', labelKey: 'wed' },
  { code: 'TH', labelKey: 'thu' },
  { code: 'FR', labelKey: 'fri' },
  { code: 'SA', labelKey: 'sat' },
  { code: 'SU', labelKey: 'sun' },
] as const;

export type WeekdayCode = (typeof WEEKDAYS)[number]['code'];

const CANONICAL_ORDER: readonly WeekdayCode[] = WEEKDAYS.map((w) => w.code);

/**
 * Build a weekly RRULE from selected weekdays, always emitting them in canonical Mon→Sun order
 * (independent of click order). Returns '' when nothing is selected so the caller can disable submit.
 */
export function buildWeeklyRrule(days: Iterable<WeekdayCode>): string {
  const set = new Set(days);
  const ordered = CANONICAL_ORDER.filter((d) => set.has(d));
  return ordered.length ? `FREQ=WEEKLY;BYDAY=${ordered.join(',')}` : '';
}
