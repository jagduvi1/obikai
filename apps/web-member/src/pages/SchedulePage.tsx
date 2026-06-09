import type { Booking, ClassOccurrence } from '@obikai/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  bookOccurrence,
  cancelBooking,
  listOccurrences,
  listPrograms,
  myBookings,
  selfCheckIn,
} from '../api/member-data';
import { useSubject } from '../subject/subject-context';

const DAYS_AHEAD = 14;
// Mirror of the server's check-in window (check-in.service.ts) so the button only shows when it works.
const CHECK_IN_LEAD_MS = 60 * 60 * 1000;
const CHECK_IN_GRACE_MS = 60 * 60 * 1000;

/** A member's live (non-cancelled) booking for an occurrence, if any. */
function liveBookingFor(bookings: Booking[], occurrenceId: string): Booking | undefined {
  return bookings.find((b) => b.occurrenceId === occurrenceId && b.status !== 'cancelled');
}

/** True when now is inside the occurrence's check-in window (start − lead … end + grace). */
function checkInOpen(o: ClassOccurrence, nowMs: number): boolean {
  return (
    nowMs >= Date.parse(o.startsAt) - CHECK_IN_LEAD_MS &&
    nowMs <= Date.parse(o.endsAt) + CHECK_IN_GRACE_MS
  );
}

/**
 * "Book a class" (§4.6) — browse upcoming occurrences and book/cancel for the active subject (yourself,
 * or a child you guardian). The booking API enforces capacity → waitlist; here we surface each
 * occurrence's state and the subject's booking. Booking is scoped to the active subject's member id;
 * self check-in is offered only for your own record (see `canSelfCheckIn`).
 */
export function SchedulePage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const {
    activeMemberId: memberId,
    active,
    loading: subjectLoading,
    isError: subjectError,
  } = useSubject();
  // Self check-in is the logged-in member putting themselves on the mat; a parent can't self-check-in
  // a child (a different endpoint/role), so the button only appears when viewing your own record.
  const canSelfCheckIn = active ? active.isSelf : false;

  const now = new Date();
  const from = now.toISOString();
  const to = new Date(now.getTime() + DAYS_AHEAD * 24 * 60 * 60 * 1000).toISOString();

  const programs = useQuery({ queryKey: ['programs'], queryFn: listPrograms });
  const occurrences = useQuery({
    queryKey: ['occurrences', from.slice(0, 10)],
    queryFn: () => listOccurrences(from, to),
  });
  const bookings = useQuery({
    queryKey: ['myBookings', memberId],
    queryFn: () => myBookings(memberId as string),
    enabled: !!memberId,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['myBookings', memberId] });
    void qc.invalidateQueries({ queryKey: ['occurrences', from.slice(0, 10)] });
  };
  const book = useMutation({
    mutationFn: (occurrenceId: string) => bookOccurrence(occurrenceId, memberId as string),
    onSuccess: invalidate,
  });
  const cancel = useMutation({ mutationFn: cancelBooking, onSuccess: invalidate });
  const checkIn = useMutation({
    mutationFn: (occurrenceId: string) => selfCheckIn(occurrenceId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['myAttendance', memberId] }),
  });

  const programName = (programId: string): string =>
    programs.data?.find((p) => p.id === programId)?.name ?? '—';
  const formatWhen = (iso: string): string => new Date(iso).toLocaleString(i18n.language);

  const upcoming: ClassOccurrence[] = (occurrences.data ?? [])
    .filter((o) => o.status !== 'cancelled')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const loading = subjectLoading || occurrences.isLoading || programs.isLoading;
  const errored = subjectError || occurrences.isError || programs.isError;

  return (
    <section aria-labelledby="schedule-heading">
      <h1 id="schedule-heading">{t('schedule.title')}</h1>
      {loading && <p>{t('schedule.loading')}</p>}
      {errored && (
        <p role="alert" className="form-error">
          {t('schedule.error')}
        </p>
      )}
      <output className="status">
        {checkIn.isSuccess ? t('schedule.checkedIn') : ''}
        {book.isError || cancel.isError || checkIn.isError ? t('schedule.actionError') : ''}
      </output>

      {upcoming.length === 0 && !loading && <p className="muted">{t('schedule.empty')}</p>}
      {upcoming.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('schedule.class')}</th>
              <th scope="col">{t('schedule.when')}</th>
              <th scope="col">{t('schedule.state')}</th>
              <th scope="col">{t('schedule.action')}</th>
            </tr>
          </thead>
          <tbody>
            {upcoming.map((o) => {
              const booking = liveBookingFor(bookings.data ?? [], o.id);
              const pending = book.isPending || cancel.isPending || checkIn.isPending;
              const canCheckIn = canSelfCheckIn && !!booking && checkInOpen(o, now.getTime());
              return (
                <tr key={o.id}>
                  <td>{programName(o.programId)}</td>
                  <td>{formatWhen(o.startsAt)}</td>
                  <td>{booking ? t(`schedule.bookingStatus.${booking.status}`) : '—'}</td>
                  <td className="action-cell">
                    {canCheckIn && (
                      <button type="button" disabled={pending} onClick={() => checkIn.mutate(o.id)}>
                        {t('schedule.checkIn')}
                      </button>
                    )}
                    {booking ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => cancel.mutate(booking.id)}
                      >
                        {t('schedule.cancel')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={pending || !memberId}
                        onClick={() => book.mutate(o.id)}
                      >
                        {t('schedule.book')}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
