import { BookingRepository, ClassOccurrenceRepository } from '@obikai/db';
import type { Booking, ClassOccurrence } from '@obikai/domain';

/**
 * The class-reminders job orchestrator (scope §4.3/§5, audit C2). It runs INSIDE an already-open
 * tenant context (the worker opens it per job, ADR-0004), so every @obikai/db repository it uses is
 * automatically tenant-scoped. It sweeps the occurrences starting within the lead window, and for each
 * booked member that has NOT yet been reminded, atomically CLAIMS the booking and then sends the
 * reminder. The claim-before-send order makes the sweep at-most-once: a re-delivered job (BullMQ
 * retries) or an overlapping hourly tick never double-reminds — it spams nobody, at the cost of an
 * occasional miss if a send fails after its claim (an acceptable trade for a reminder).
 */

/** Narrow capability surfaces so the orchestrator unit-tests against light fakes. */
export interface UpcomingOccurrenceSource {
  list(opts: { from?: string; to?: string }): Promise<ClassOccurrence[]>;
}
export interface RosterSource {
  listByOccurrence(occurrenceId: string, opts?: { status?: 'booked' }): Promise<Booking[]>;
  claimForReminder(id: string, now: string): Promise<Booking | null>;
}
/** Sends one reminder for a claimed booking. Returns false when there is no one to email (no address
 *  on file) — the booking stays claimed (retrying wouldn't find an address), it just isn't counted as sent. */
export interface ClassReminderSender {
  classReminder(occurrence: ClassOccurrence, booking: Booking): Promise<boolean>;
}
export type JobLog = (msg: string, meta?: Record<string, unknown>) => void;

export interface ReminderRunResult {
  /** Occurrences starting in the lead window (status `scheduled`). */
  occurrences: number;
  /** Booked bookings across those occurrences. */
  considered: number;
  /** Reminders actually emailed. */
  sent: number;
  /** Bookings already claimed by an earlier sweep (skipped). */
  alreadySent: number;
  /** Claimed bookings whose member had no email (nothing sent). */
  noRecipient: number;
  /** Claimed bookings whose send threw (logged; the claim stands — at-most-once). */
  failed: number;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * reminders: email each booked member of every class starting within `leadMs` from now, once. Cancelled
 * occurrences are skipped. Per-booking isolation — a failed send is logged and counted, never aborting
 * the sweep.
 */
export async function runRemindersForTenant(
  occurrences: UpcomingOccurrenceSource,
  roster: RosterSource,
  sender: ClassReminderSender,
  now: () => Date,
  leadMs: number,
  log: JobLog,
): Promise<ReminderRunResult> {
  const nowMs = now().getTime();
  const fromIso = new Date(nowMs).toISOString();
  const toIso = new Date(nowMs + leadMs).toISOString();
  const upcoming = (await occurrences.list({ from: fromIso, to: toIso })).filter(
    (occ) => occ.status === 'scheduled',
  );

  let considered = 0;
  let sent = 0;
  let alreadySent = 0;
  let noRecipient = 0;
  let failed = 0;

  for (const occ of upcoming) {
    const booked = await roster.listByOccurrence(occ.id, { status: 'booked' });
    considered += booked.length;
    for (const booking of booked) {
      const claimed = await roster.claimForReminder(booking.id, fromIso);
      if (!claimed) {
        alreadySent++; // a concurrent/earlier sweep already reminded this booking
        continue;
      }
      try {
        const wasSent = await sender.classReminder(occ, claimed);
        if (wasSent) sent++;
        else noRecipient++;
      } catch (err) {
        failed++;
        log('reminders: send failed', { bookingId: claimed.id, error: errMsg(err) });
      }
    }
  }
  return { occurrences: upcoming.length, considered, sent, alreadySent, noRecipient, failed };
}

/**
 * Construct the occurrence + roster repositories the sweep needs, all backed by @obikai/db. Built per
 * job (repositories are stateless and read the active tenant context at query time). The reminder
 * SENDER (which also needs program/location/schedule/member lookups) is the worker's notifier — wired
 * separately in main.ts so the sweep stays decoupled from email transport.
 */
export function makeReminderDeps(): {
  occurrences: ClassOccurrenceRepository;
  roster: BookingRepository;
} {
  return { occurrences: new ClassOccurrenceRepository(), roster: new BookingRepository() };
}
