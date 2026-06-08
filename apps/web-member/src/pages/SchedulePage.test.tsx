import type { Booking, ClassOccurrence, Program } from '@obikai/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SchedulePage } from './SchedulePage';

const { getMe, listPrograms, listOccurrences, myBookings, bookOccurrence, cancelBooking } =
  vi.hoisted(() => ({
    getMe: vi.fn(),
    listPrograms: vi.fn(),
    listOccurrences: vi.fn(),
    myBookings: vi.fn(),
    bookOccurrence: vi.fn(),
    cancelBooking: vi.fn(),
  }));

vi.mock('../api/member-data', () => ({
  getMe,
  listPrograms,
  listOccurrences,
  myBookings,
  bookOccurrence,
  cancelBooking,
}));

// Branded IDs are nominal — the fixtures use `as` assertions, the same pattern as the other tests.
const program = () => ({ id: 'prog1', name: 'Adults BJJ' }) as Program;
const occurrence = () =>
  ({
    id: 'occ1',
    tenantId: 't1',
    scheduleId: 'sch1',
    programId: 'prog1',
    locationId: 'loc1',
    startsAt: '2099-06-10T16:00:00.000Z',
    endsAt: '2099-06-10T17:00:00.000Z',
    capacity: 10,
    status: 'scheduled',
    createdAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:00.000Z',
  }) as ClassOccurrence;
const booking = (over: Partial<Booking> = {}) =>
  ({
    id: 'b1',
    tenantId: 't1',
    occurrenceId: 'occ1',
    memberId: 'm1',
    status: 'booked',
    bookedAt: '2026-06-06T00:00:00.000Z',
    reminderSentAt: null,
    createdAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:00.000Z',
    ...over,
  }) as Booking;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SchedulePage />
    </QueryClientProvider>,
  );
}

describe('SchedulePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMe.mockResolvedValue({ userId: 'u1', memberId: 'm1', roles: [] });
    listPrograms.mockResolvedValue([program()]);
    listOccurrences.mockResolvedValue([occurrence()]);
  });

  it('lists an upcoming class and books the member into it', async () => {
    myBookings.mockResolvedValue([]); // not booked yet
    bookOccurrence.mockResolvedValue(booking());
    const user = userEvent.setup();
    renderPage();

    // The program name renders, with a Book action.
    expect(await screen.findByText('Adults BJJ')).toBeInTheDocument();
    const bookBtn = await screen.findByRole('button', { name: /^book$/i });
    await user.click(bookBtn);

    await waitFor(() => expect(bookOccurrence).toHaveBeenCalledWith('occ1', 'm1'));
  });

  it('shows a booked class with a cancel action', async () => {
    myBookings.mockResolvedValue([booking({ status: 'booked' })]);
    renderPage();

    expect(await screen.findByText('Adults BJJ')).toBeInTheDocument();
    expect(await screen.findByText('Booked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^book$/i })).not.toBeInTheDocument();
  });
});
