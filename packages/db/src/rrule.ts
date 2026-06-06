/**
 * A small, dependency-free weekly RRULE expander (ADR-0014). We deliberately do NOT pull in the
 * `rrule` npm package (license/dependency risk, ADR-0003): scheduling only needs a tiny iCal subset
 * — `FREQ=WEEKLY;BYDAY=...` with optional `INTERVAL`, `COUNT`, `UNTIL`. Given a schedule's local
 * `startTime`/`durationMin`/`timezone`, it generates concrete occurrence instants between a
 * `from`/`to` window.
 *
 * Timezone correctness (DST): we resolve a local `YYYY-MM-DD HH:mm` in the schedule's IANA timezone
 * to a UTC instant using `Intl.DateTimeFormat` — never a fixed offset — so an occurrence at 18:00
 * local stays 18:00 local across a DST boundary even though its UTC offset shifts. Output is
 * deterministic and unit-tested.
 */

/** iCal weekday tokens, in ISO order (MO=Monday … SU=Sunday). */
export const RRULE_WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type RruleWeekday = (typeof RRULE_WEEKDAYS)[number];

/** Map an iCal weekday token to a JS `Date.getUTCDay()` value (SU=0 … SA=6). */
const WEEKDAY_TO_JS_DAY: Record<RruleWeekday, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

/** The parsed weekly RRULE subset this expander understands. */
export interface ParsedRrule {
  readonly freq: 'WEEKLY';
  /** Weekdays the series fires on (BYDAY), at least one. */
  readonly byDay: readonly RruleWeekday[];
  /** Every Nth week (INTERVAL), default 1. */
  readonly interval: number;
  /** Cap on the number of generated instants (COUNT), or null for unbounded. */
  readonly count: number | null;
  /** Inclusive end instant (UNTIL) as a UTC ISO string, or null for unbounded. */
  readonly until: string | null;
}

export class RruleParseError extends Error {
  constructor(detail: string) {
    super(`invalid RRULE: ${detail}`);
    this.name = 'RruleParseError';
  }
}

/** Split an `RRULE:FREQ=WEEKLY;...` string into its key/value parts (the `RRULE:` prefix optional). */
function toParts(rrule: string): Map<string, string> {
  const body = rrule.trim().replace(/^RRULE:/i, '');
  const parts = new Map<string, string>();
  for (const segment of body.split(';')) {
    if (segment === '') continue;
    const eq = segment.indexOf('=');
    if (eq === -1) throw new RruleParseError(`malformed segment "${segment}"`);
    parts.set(segment.slice(0, eq).trim().toUpperCase(), segment.slice(eq + 1).trim());
  }
  return parts;
}

/** Parse an iCal `UNTIL` value (`YYYYMMDD` or `YYYYMMDDTHHMMSSZ`) to a UTC ISO string. */
function parseUntil(raw: string): string {
  const basic = raw.trim().toUpperCase();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(basic);
  if (!m) throw new RruleParseError(`UNTIL "${raw}" is not a basic iCal date/date-time`);
  const hh = m[4] ?? '23';
  const mm = m[5] ?? '59';
  const ss = m[6] ?? '59';
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +hh, +mm, +ss)).toISOString();
}

/** Parse the supported weekly RRULE subset; throws `RruleParseError` on anything outside it. */
export function parseRrule(rrule: string): ParsedRrule {
  const parts = toParts(rrule);

  const freq = parts.get('FREQ');
  if (freq !== 'WEEKLY') {
    throw new RruleParseError(`only FREQ=WEEKLY is supported (got "${freq ?? 'none'}")`);
  }

  const byDayRaw = parts.get('BYDAY');
  if (!byDayRaw) throw new RruleParseError('BYDAY is required for FREQ=WEEKLY');
  const byDay = byDayRaw
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t !== '');
  if (byDay.length === 0) throw new RruleParseError('BYDAY must list at least one weekday');
  for (const token of byDay) {
    if (!(token in WEEKDAY_TO_JS_DAY)) throw new RruleParseError(`unknown BYDAY token "${token}"`);
  }

  let interval = 1;
  const intervalRaw = parts.get('INTERVAL');
  if (intervalRaw !== undefined) {
    interval = Number.parseInt(intervalRaw, 10);
    if (!Number.isInteger(interval) || interval < 1) {
      throw new RruleParseError(`INTERVAL must be a positive integer (got "${intervalRaw}")`);
    }
  }

  let count: number | null = null;
  const countRaw = parts.get('COUNT');
  if (countRaw !== undefined) {
    count = Number.parseInt(countRaw, 10);
    if (!Number.isInteger(count) || count < 1) {
      throw new RruleParseError(`COUNT must be a positive integer (got "${countRaw}")`);
    }
  }

  const untilRaw = parts.get('UNTIL');
  const until = untilRaw !== undefined ? parseUntil(untilRaw) : null;

  return {
    freq: 'WEEKLY',
    byDay: byDay as RruleWeekday[],
    interval,
    count,
    until,
  };
}

/**
 * Resolve the UTC offset (in minutes) of `instant` in `timezone`. Uses `Intl` so it is DST-correct.
 * Positive east of UTC (e.g. Europe/Stockholm CEST = +120).
 */
function offsetMinutes(instant: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: string): number =>
    Number.parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  // The wall-clock time `timezone` shows for `instant`, read back as if it were UTC.
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/**
 * Convert a local wall-clock `YYYY-MM-DD HH:mm` in `timezone` to the UTC instant it denotes,
 * DST-correctly. We seed with the naive-UTC interpretation, measure the zone offset there, correct,
 * then re-measure once to settle DST-transition edge cases.
 */
function localWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = new Date(naiveUtc - offsetMinutes(new Date(naiveUtc), timezone) * 60000);
  // Re-settle: the offset at the corrected instant may differ across a DST boundary.
  instant = new Date(naiveUtc - offsetMinutes(instant, timezone) * 60000);
  return instant;
}

/** A single generated occurrence window (UTC ISO instants). */
export interface ExpandedOccurrence {
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface ExpandOptions {
  readonly rrule: string;
  /** Local start time `HH:mm` in `timezone`. */
  readonly startTime: string;
  readonly durationMin: number;
  readonly timezone: string;
  /** The series anchor: the first local date (`YYYY-MM-DD`) the rule may fire on or after. */
  readonly seriesStart: string;
  /** Window lower bound (inclusive), UTC ISO. */
  readonly from: string;
  /** Window upper bound (exclusive), UTC ISO. */
  readonly to: string;
}

/** Days in `month` (1-12) of `year`, Gregorian. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** ISO week index of a local date relative to an anchor Monday, for INTERVAL gating. */
function weeksSinceAnchor(
  anchor: { year: number; month: number; day: number },
  date: { year: number; month: number; day: number },
): number {
  // Use UTC midnights purely as a stable day counter (no tz math needed for whole-day deltas).
  const anchorMs = Date.UTC(anchor.year, anchor.month - 1, anchor.day);
  const dateMs = Date.UTC(date.year, date.month - 1, date.day);
  const days = Math.floor((dateMs - anchorMs) / 86400000);
  return Math.floor(days / 7);
}

/**
 * Expand the weekly RRULE into concrete occurrence windows between `from` (inclusive) and `to`
 * (exclusive), respecting COUNT/UNTIL and the schedule's timezone. COUNT is counted from the series
 * anchor, NOT from the window, so windowing never changes which instances exist.
 */
export function expandWeekly(opts: ExpandOptions): ExpandedOccurrence[] {
  const rule = parseRrule(opts.rrule);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(opts.startTime.trim());
  if (!timeMatch) throw new RruleParseError(`startTime "${opts.startTime}" must be HH:mm`);
  const startHour = Number.parseInt(timeMatch[1]!, 10);
  const startMinute = Number.parseInt(timeMatch[2]!, 10);
  if (startHour > 23 || startMinute > 59) {
    throw new RruleParseError(`startTime "${opts.startTime}" is out of range`);
  }

  const fromMs = new Date(opts.from).getTime();
  const toMs = new Date(opts.to).getTime();
  const untilMs = rule.until !== null ? new Date(rule.until).getTime() : null;

  const anchorMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opts.seriesStart.trim());
  if (!anchorMatch)
    throw new RruleParseError(`seriesStart "${opts.seriesStart}" must be YYYY-MM-DD`);
  const anchor = {
    year: Number.parseInt(anchorMatch[1]!, 10),
    month: Number.parseInt(anchorMatch[2]!, 10),
    day: Number.parseInt(anchorMatch[3]!, 10),
  };
  const wantedDays = new Set(rule.byDay.map((d) => WEEKDAY_TO_JS_DAY[d]));

  const out: ExpandedOccurrence[] = [];
  let emitted = 0;

  // Walk local calendar days from the anchor forward. Bound the loop by COUNT/UNTIL/`to` so it
  // always terminates even for an unbounded rule (we stop once past the window AND no COUNT left).
  let cursor = { ...anchor };
  // Generous hard cap: years of daily iteration guard against a pathological unbounded+wide window.
  for (let guard = 0; guard < 366 * 50; guard++) {
    const cursorMidnightUtc = Date.UTC(cursor.year, cursor.month - 1, cursor.day);
    const jsDay = new Date(cursorMidnightUtc).getUTCDay();

    if (wantedDays.has(jsDay)) {
      const weekIndex = weeksSinceAnchor(anchor, cursor);
      if (weekIndex >= 0 && weekIndex % rule.interval === 0) {
        const startsAt = localWallTimeToUtc(
          cursor.year,
          cursor.month,
          cursor.day,
          startHour,
          startMinute,
          opts.timezone,
        );
        const startMs = startsAt.getTime();

        const pastUntil = untilMs !== null && startMs > untilMs;
        const pastCount = rule.count !== null && emitted >= rule.count;
        if (pastUntil || pastCount) break;

        // This instance "exists" in the series; count it toward COUNT regardless of the window.
        emitted++;
        if (startMs >= fromMs && startMs < toMs) {
          out.push({
            startsAt: startsAt.toISOString(),
            endsAt: new Date(startMs + opts.durationMin * 60000).toISOString(),
          });
        }
        // Once we are past the window's upper bound and COUNT is unbounded, we can stop early.
        if (startMs >= toMs && rule.count === null && untilMs === null) break;
      }
    }

    // Advance one local calendar day.
    if (cursor.day < daysInMonth(cursor.year, cursor.month)) {
      cursor = { ...cursor, day: cursor.day + 1 };
    } else if (cursor.month < 12) {
      cursor = { year: cursor.year, month: cursor.month + 1, day: 1 };
    } else {
      cursor = { year: cursor.year + 1, month: 1, day: 1 };
    }

    // Terminate cleanly once the cursor itself is past `to` and nothing bounded remains to emit.
    if (Date.UTC(cursor.year, cursor.month - 1, cursor.day) > toMs && rule.count === null) break;
  }

  return out;
}
