/**
 * Unit tests for the dependency-free weekly RRULE expander (ADR-0014). Pure function, no Mongo:
 * verifies multi-day weekly expansion, INTERVAL, COUNT, UNTIL, and DST-boundary stability (an 18:00
 * local class stays 18:00 local across the spring-forward transition even as its UTC offset shifts).
 */
import { describe, expect, it } from 'vitest';
import { RruleParseError, expandWeekly, parseRrule } from '../src/rrule.js';

/** Read an instant's wall-clock `HH:mm` in a timezone (to assert DST stability). */
function localHHmm(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

describe('parseRrule', () => {
  it('parses a multi-day weekly rule with defaults', () => {
    const r = parseRrule('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(r.freq).toBe('WEEKLY');
    expect(r.byDay).toEqual(['MO', 'WE', 'FR']);
    expect(r.interval).toBe(1);
    expect(r.count).toBeNull();
    expect(r.until).toBeNull();
  });

  it('parses INTERVAL, COUNT and UNTIL (with the RRULE: prefix)', () => {
    const r = parseRrule('RRULE:FREQ=WEEKLY;BYDAY=TU;INTERVAL=2;COUNT=5;UNTIL=20260701T000000Z');
    expect(r.interval).toBe(2);
    expect(r.count).toBe(5);
    expect(r.until).toBe('2026-07-01T00:00:00.000Z');
  });

  it('rejects non-weekly frequencies and missing BYDAY', () => {
    expect(() => parseRrule('FREQ=DAILY;BYDAY=MO')).toThrow(RruleParseError);
    expect(() => parseRrule('FREQ=WEEKLY')).toThrow(RruleParseError);
    expect(() => parseRrule('FREQ=WEEKLY;BYDAY=XX')).toThrow(RruleParseError);
  });
});

describe('expandWeekly', () => {
  const tz = 'Europe/Stockholm';

  it('expands a multi-day weekly rule within a window', () => {
    // Anchor Mon 2026-06-01; expect Mon/Wed/Fri at 18:00 local through one week.
    const occ = expandWeekly({
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      startTime: '18:00',
      durationMin: 60,
      timezone: tz,
      seriesStart: '2026-06-01',
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-08T00:00:00.000Z',
    });
    expect(occ).toHaveLength(3);
    // All at 18:00 local, 60-min long.
    for (const o of occ) {
      expect(localHHmm(o.startsAt, tz)).toBe('18:00');
      expect(localHHmm(o.endsAt, tz)).toBe('19:00');
    }
    // Mon, Wed, Fri local dates.
    const days = occ.map((o) =>
      new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(
        new Date(o.startsAt),
      ),
    );
    expect(days).toEqual(['Mon', 'Wed', 'Fri']);
  });

  it('honours INTERVAL=2 (every other week)', () => {
    const occ = expandWeekly({
      rrule: 'FREQ=WEEKLY;BYDAY=MO;INTERVAL=2',
      startTime: '09:00',
      durationMin: 60,
      timezone: tz,
      seriesStart: '2026-06-01',
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    });
    // Mondays in June 2026: 1, 8, 15, 22, 29 → every other from anchor → 1, 15, 29.
    expect(occ).toHaveLength(3);
    const dates = occ.map((o) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(
        new Date(o.startsAt),
      ),
    );
    expect(dates).toEqual(['2026-06-01', '2026-06-15', '2026-06-29']);
  });

  it('caps generation at COUNT, counted from the series anchor not the window', () => {
    const occ = expandWeekly({
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=4',
      startTime: '18:00',
      durationMin: 60,
      timezone: tz,
      seriesStart: '2026-06-01',
      from: '2026-06-01T00:00:00.000Z',
      to: '2027-01-01T00:00:00.000Z',
    });
    // Mon 1, Wed 3, Fri 5, Mon 8 — then COUNT exhausted.
    expect(occ).toHaveLength(4);
    const dates = occ.map((o) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(
        new Date(o.startsAt),
      ),
    );
    expect(dates).toEqual(['2026-06-01', '2026-06-03', '2026-06-05', '2026-06-08']);
  });

  it('stops at UNTIL (inclusive of the UNTIL instant)', () => {
    const occ = expandWeekly({
      rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20260615T235959Z',
      startTime: '18:00',
      durationMin: 60,
      timezone: tz,
      seriesStart: '2026-06-01',
      from: '2026-06-01T00:00:00.000Z',
      to: '2027-01-01T00:00:00.000Z',
    });
    // Mondays up to and including 2026-06-15.
    const dates = occ.map((o) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(
        new Date(o.startsAt),
      ),
    );
    expect(dates).toEqual(['2026-06-01', '2026-06-08', '2026-06-15']);
  });

  it('keeps local time stable across a DST spring-forward boundary', () => {
    // Sweden springs forward 2026-03-29 (CET +01:00 → CEST +02:00). A Sunday 18:00 class on
    // 2026-03-22 (pre) and 2026-03-29 (the transition day) must both read 18:00 local but have
    // DIFFERENT UTC instants (17:00Z vs 16:00Z).
    const occ = expandWeekly({
      rrule: 'FREQ=WEEKLY;BYDAY=SU',
      startTime: '18:00',
      durationMin: 60,
      timezone: tz,
      seriesStart: '2026-03-22',
      from: '2026-03-22T00:00:00.000Z',
      to: '2026-04-06T00:00:00.000Z',
    });
    expect(occ).toHaveLength(3); // Sun 22, Sun 29, Sun 5 Apr
    for (const o of occ) {
      expect(localHHmm(o.startsAt, tz)).toBe('18:00');
    }
    // Pre-transition is +01:00 (17:00Z); on/after is +02:00 (16:00Z) — proves we used a real tz,
    // not a frozen offset.
    expect(occ[0].startsAt).toBe('2026-03-22T17:00:00.000Z');
    expect(occ[1].startsAt).toBe('2026-03-29T16:00:00.000Z');
    expect(occ[2].startsAt).toBe('2026-04-05T16:00:00.000Z');
  });

  it('is deterministic: same inputs → identical output', () => {
    const opts = {
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TH',
      startTime: '07:30',
      durationMin: 45,
      timezone: tz,
      seriesStart: '2026-06-01',
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-30T00:00:00.000Z',
    };
    expect(expandWeekly(opts)).toEqual(expandWeekly(opts));
  });
});
