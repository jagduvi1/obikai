import type { Booking, ClassOccurrence } from '@obikai/domain';
import { describe, expect, it } from 'vitest';
import {
  type ClassReminderSender,
  type JobLog,
  type RosterSource,
  type UpcomingOccurrenceSource,
  runRemindersForTenant,
} from '../src/reminders-jobs.js';

const NOW = (): Date => new Date('2026-06-06T00:00:00.000Z');
const LEAD = 24 * 60 * 60 * 1_000; // 24h

const occ = (id: string, startsAt: string, over: Partial<ClassOccurrence> = {}): ClassOccurrence =>
  ({ id, startsAt, status: 'scheduled', ...over }) as ClassOccurrence;
const bk = (id: string, occurrenceId: string): Booking =>
  ({ id, occurrenceId, memberId: `m-${id}`, status: 'booked', reminderSentAt: null }) as Booking;

function makeLog(): { log: JobLog; lines: { msg: string; meta?: Record<string, unknown> }[] } {
  const lines: { msg: string; meta?: Record<string, unknown> }[] = [];
  return { log: (msg, meta) => lines.push({ msg, meta }), lines };
}

/** Occurrence source that honours the [from, to) window like the real repository. */
function occurrenceSource(all: ClassOccurrence[]): UpcomingOccurrenceSource {
  return {
    async list({ from, to }) {
      return all.filter((o) => (!from || o.startsAt >= from) && (!to || o.startsAt < to));
    },
  };
}

/** Roster fake: bookings per occurrence + a one-shot atomic claim (null on the second claim). */
function rosterSource(bookings: Booking[]): RosterSource & { claimed: Set<string> } {
  const claimed = new Set<string>();
  return {
    claimed,
    async listByOccurrence(occurrenceId, opts) {
      return bookings
        .filter((b) => b.occurrenceId === occurrenceId)
        .filter((b) => (opts?.status ? b.status === opts.status : true));
    },
    async claimForReminder(id) {
      if (claimed.has(id)) return null; // already reminded by an earlier/concurrent sweep
      claimed.add(id);
      return { ...bookings.find((b) => b.id === id)!, reminderSentAt: '2026-06-06T00:00:00.000Z' };
    },
  };
}

describe('runRemindersForTenant', () => {
  it('reminds every booked member of in-window scheduled occurrences', async () => {
    const occurrences = occurrenceSource([
      occ('o1', '2026-06-06T10:00:00.000Z'),
      occ('o2', '2026-06-06T18:00:00.000Z'),
    ]);
    const bookings = [bk('a', 'o1'), bk('b', 'o1'), bk('c', 'o2')];
    const roster = rosterSource(bookings);
    const sent: string[] = [];
    const sender: ClassReminderSender = {
      async classReminder(_o, booking) {
        sent.push(booking.id);
        return true;
      },
    };
    const { log } = makeLog();
    const r = await runRemindersForTenant(occurrences, roster, sender, NOW, LEAD, log);
    expect(sent.sort()).toEqual(['a', 'b', 'c']);
    expect(r).toEqual({
      occurrences: 2,
      considered: 3,
      sent: 3,
      alreadySent: 0,
      noRecipient: 0,
      failed: 0,
    });
  });

  it('excludes occurrences outside the lead window', async () => {
    const occurrences = occurrenceSource([
      occ('soon', '2026-06-06T12:00:00.000Z'),
      occ('too-far', '2026-06-08T12:00:00.000Z'), // > 24h ahead
      occ('past', '2026-06-05T12:00:00.000Z'), // already started
    ]);
    const roster = rosterSource([bk('a', 'soon'), bk('b', 'too-far'), bk('c', 'past')]);
    const seen: string[] = [];
    const sender: ClassReminderSender = {
      async classReminder(o, _b) {
        seen.push(o.id);
        return true;
      },
    };
    const { log } = makeLog();
    const r = await runRemindersForTenant(occurrences, roster, sender, NOW, LEAD, log);
    expect(seen).toEqual(['soon']);
    expect(r.occurrences).toBe(1);
    expect(r.sent).toBe(1);
  });

  it('skips cancelled occurrences even inside the window', async () => {
    const occurrences = occurrenceSource([
      occ('live', '2026-06-06T10:00:00.000Z'),
      occ('cxl', '2026-06-06T11:00:00.000Z', { status: 'cancelled' }),
    ]);
    const roster = rosterSource([bk('a', 'live'), bk('b', 'cxl')]);
    const sent: string[] = [];
    const sender: ClassReminderSender = {
      async classReminder(_o, booking) {
        sent.push(booking.id);
        return true;
      },
    };
    const { log } = makeLog();
    const r = await runRemindersForTenant(occurrences, roster, sender, NOW, LEAD, log);
    expect(sent).toEqual(['a']);
    expect(r.occurrences).toBe(1);
  });

  it('counts an already-claimed booking as alreadySent and never calls the sender for it', async () => {
    const occurrences = occurrenceSource([occ('o1', '2026-06-06T10:00:00.000Z')]);
    const roster = rosterSource([bk('a', 'o1'), bk('b', 'o1')]);
    roster.claimed.add('a'); // a prior sweep already reminded 'a'
    const sent: string[] = [];
    const sender: ClassReminderSender = {
      async classReminder(_o, booking) {
        sent.push(booking.id);
        return true;
      },
    };
    const { log } = makeLog();
    const r = await runRemindersForTenant(occurrences, roster, sender, NOW, LEAD, log);
    expect(sent).toEqual(['b']); // 'a' was never sent again
    expect(r).toEqual({
      occurrences: 1,
      considered: 2,
      sent: 1,
      alreadySent: 1,
      noRecipient: 0,
      failed: 0,
    });
  });

  it('counts a no-recipient send (returns false) separately from a real send', async () => {
    const occurrences = occurrenceSource([occ('o1', '2026-06-06T10:00:00.000Z')]);
    const roster = rosterSource([bk('a', 'o1'), bk('b', 'o1')]);
    const sender: ClassReminderSender = {
      async classReminder(_o, booking) {
        return booking.id === 'a'; // 'b' has no email → false
      },
    };
    const { log } = makeLog();
    const r = await runRemindersForTenant(occurrences, roster, sender, NOW, LEAD, log);
    expect(r.sent).toBe(1);
    expect(r.noRecipient).toBe(1);
  });

  it('isolates a failing send: logs it, counts it, keeps going (claim already stands)', async () => {
    const occurrences = occurrenceSource([occ('o1', '2026-06-06T10:00:00.000Z')]);
    const roster = rosterSource([bk('a', 'o1'), bk('b', 'o1'), bk('c', 'o1')]);
    const sender: ClassReminderSender = {
      async classReminder(_o, booking) {
        if (booking.id === 'b') throw new Error('smtp down');
        return true;
      },
    };
    const { log, lines } = makeLog();
    const r = await runRemindersForTenant(occurrences, roster, sender, NOW, LEAD, log);
    expect(r).toEqual({
      occurrences: 1,
      considered: 3,
      sent: 2,
      alreadySent: 0,
      noRecipient: 0,
      failed: 1,
    });
    const failLine = lines.find((l) => l.msg === 'reminders: send failed');
    expect(failLine?.meta?.bookingId).toBe('b');
  });
});
