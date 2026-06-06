import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { recordAttendance } from '../api/attendance';
import { listLocations } from '../api/locations';
import { listMembers } from '../api/members';
import {
  cancelBooking,
  cancelOccurrence,
  createBooking,
  getOccurrence,
  listOccurrenceBookings,
  listPrograms,
} from '../api/scheduling';

/** Booking statuses that occupy a seat (so the member shouldn't be offered for re-booking). */
const ACTIVE_BOOKING_STATUSES = new Set(['booked', 'waitlisted', 'attended']);

/**
 * Occurrence detail (ADR-0014): one materialized class — its roster (bookings), the ability to add
 * or cancel bookings, cancel the whole occurrence, and record attendance per member. Attendance is
 * the canonical check-in that feeds rank eligibility, distinct from the booking itself.
 */
export function OccurrenceDetailPage() {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [toBook, setToBook] = useState('');
  // No endpoint lists attendance per occurrence, so we track what we recorded this session to give
  // immediate feedback and prevent obvious double-clicks.
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('');

  const occurrence = useQuery({
    queryKey: ['occurrence', id],
    queryFn: () => getOccurrence(id),
    enabled: !!id,
  });
  const bookings = useQuery({
    queryKey: ['occurrenceBookings', id],
    queryFn: () => listOccurrenceBookings(id),
    enabled: !!id,
  });
  const members = useQuery({ queryKey: ['members'], queryFn: () => listMembers() });
  const programs = useQuery({ queryKey: ['programs'], queryFn: () => listPrograms() });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => listLocations() });

  const memberName = useMemo(() => {
    const map = new Map<string, string>(
      (members.data ?? []).map((m) => [m.id, `${m.firstName} ${m.lastName}`]),
    );
    return (mid: string) => map.get(mid) ?? mid;
  }, [members.data]);

  const occProgram = useMemo(
    () => (programs.data ?? []).find((p) => p.id === occurrence.data?.programId),
    [programs.data, occurrence.data?.programId],
  );
  const locationName = (lid: string) =>
    (locations.data ?? []).find((l) => l.id === lid)?.name ?? lid;

  const book = useMutation({
    mutationFn: (memberId: string) => createBooking({ occurrenceId: id, memberId }),
    onSuccess: () => {
      setToBook('');
      void qc.invalidateQueries({ queryKey: ['occurrenceBookings', id] });
    },
  });
  const unbook = useMutation({
    mutationFn: (bookingId: string) => cancelBooking(bookingId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['occurrenceBookings', id] }),
  });
  const cancelOcc = useMutation({
    mutationFn: () => cancelOccurrence(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['occurrence', id] }),
  });
  const attend = useMutation({
    mutationFn: (memberId: string) =>
      recordAttendance({
        memberId,
        occurrenceId: id,
        programId: occurrence.data?.programId ?? null,
        disciplineId: occProgram?.disciplineId ?? null,
        method: 'instructor',
      }),
    onSuccess: (_data, memberId) => {
      setMarked((prev) => new Set(prev).add(memberId));
      setStatus(t('occurrence.attendanceRecorded', { name: memberName(memberId) }));
    },
    onError: () => setStatus(t('occurrence.attendanceError')),
  });

  const bookedMemberIds = new Set(
    (bookings.data ?? [])
      .filter((b) => ACTIVE_BOOKING_STATUSES.has(b.status))
      .map((b) => b.memberId),
  );
  const bookable = (members.data ?? []).filter((m) => !bookedMemberIds.has(m.id));
  const occ = occurrence.data;
  const isCancelled = occ?.status === 'cancelled';

  return (
    <div>
      <p>
        <Link to="/occurrences">← {t('occurrences.title')}</Link>
      </p>

      {occurrence.isLoading && <p>{t('occurrence.loading')}</p>}
      {occurrence.isError && <p className="form-error">{t('occurrence.error')}</p>}

      {occ && (
        <>
          <h1>{occProgram?.name ?? t('occurrence.title')}</h1>
          <dl className="meta">
            <div>
              <dt>{t('occurrence.when')}</dt>
              <dd>
                {new Date(occ.startsAt).toLocaleString(i18n.language)} –{' '}
                {new Date(occ.endsAt).toLocaleTimeString(i18n.language)}
              </dd>
            </div>
            <div>
              <dt>{t('occurrence.location')}</dt>
              <dd>{locationName(occ.locationId)}</dd>
            </div>
            <div>
              <dt>{t('occurrence.capacity')}</dt>
              <dd>{occ.capacity}</dd>
            </div>
            <div>
              <dt>{t('occurrence.status')}</dt>
              <dd>{t(`occurrences.statusValue.${occ.status}`)}</dd>
            </div>
          </dl>

          {!isCancelled && (
            <button
              type="button"
              className="link-button danger"
              onClick={() => cancelOcc.mutate()}
              disabled={cancelOcc.isPending}
            >
              {t('occurrence.cancelOccurrence')}
            </button>
          )}

          <section aria-labelledby="roster-heading">
            <h2 id="roster-heading">{t('occurrence.roster')}</h2>

            {!isCancelled && (
              <form
                className="enroll-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (toBook) book.mutate(toBook);
                }}
              >
                <label htmlFor="book-select">{t('occurrence.addMember')}</label>
                <select id="book-select" value={toBook} onChange={(e) => setToBook(e.target.value)}>
                  <option value="">{t('occurrence.selectMember')}</option>
                  {bookable.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.firstName} {m.lastName}
                    </option>
                  ))}
                </select>
                <button type="submit" disabled={!toBook || book.isPending}>
                  {t('occurrence.book')}
                </button>
              </form>
            )}
            {book.isError && <p className="form-error">{t('occurrence.bookError')}</p>}
            <output className="status">{status}</output>

            {bookings.data && bookings.data.length === 0 && (
              <p className="muted">{t('occurrence.emptyRoster')}</p>
            )}
            {bookings.data && bookings.data.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('occurrence.member')}</th>
                    <th scope="col">{t('occurrence.bookingStatus')}</th>
                    <th scope="col">{t('occurrence.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.data.map((b) => (
                    <tr key={b.id}>
                      <td>{memberName(b.memberId)}</td>
                      <td>{t(`bookings.statusValue.${b.status}`)}</td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => attend.mutate(b.memberId)}
                          disabled={attend.isPending || marked.has(b.memberId)}
                        >
                          {marked.has(b.memberId)
                            ? t('occurrence.present')
                            : t('occurrence.markPresent')}
                        </button>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => unbook.mutate(b.id)}
                          disabled={unbook.isPending}
                        >
                          {t('occurrence.cancelBooking')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
