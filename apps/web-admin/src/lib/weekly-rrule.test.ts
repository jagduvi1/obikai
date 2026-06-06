import { describe, expect, it } from 'vitest';
import { type WeekdayCode, buildWeeklyRrule } from './weekly-rrule';

describe('buildWeeklyRrule', () => {
  it('emits a FREQ=WEEKLY rule with the selected days', () => {
    expect(buildWeeklyRrule(['MO', 'WE', 'FR'])).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
  });

  it('normalizes to canonical Mon→Sun order regardless of input order', () => {
    expect(buildWeeklyRrule(['FR', 'MO', 'WE'])).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
  });

  it('deduplicates repeated days', () => {
    expect(buildWeeklyRrule(['MO', 'MO', 'TU'])).toBe('FREQ=WEEKLY;BYDAY=MO,TU');
  });

  it('returns an empty string when no days are selected', () => {
    expect(buildWeeklyRrule([])).toBe('');
    expect(buildWeeklyRrule(new Set<WeekdayCode>())).toBe('');
  });
});
