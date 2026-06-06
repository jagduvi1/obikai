import type { Booking, ClassOccurrence, Location, Member, Program } from '@obikai/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { OccurrenceDetailPage } from './OccurrenceDetailPage';

vi.mock('../api/scheduling', () => ({
  getOccurrence: vi.fn().mockResolvedValue({
    id: 'o1',
    scheduleId: 's1',
    programId: 'p1',
    locationId: 'l1',
    startsAt: '2026-06-10T16:00:00.000Z',
    endsAt: '2026-06-10T17:00:00.000Z',
    capacity: 20,
    status: 'scheduled',
  } as ClassOccurrence),
  listOccurrenceBookings: vi
    .fn()
    .mockResolvedValue([
      { id: 'b1', occurrenceId: 'o1', memberId: 'm1', status: 'booked', bookedAt: '2026-06-01' },
    ] as Booking[]),
  listPrograms: vi
    .fn()
    .mockResolvedValue([
      { id: 'p1', name: 'Kids BJJ', disciplineId: 'd1', active: true },
    ] as Program[]),
  createBooking: vi.fn(),
  cancelBooking: vi.fn(),
  cancelOccurrence: vi.fn(),
}));
vi.mock('../api/locations', () => ({
  listLocations: vi
    .fn()
    .mockResolvedValue([
      { id: 'l1', name: 'Dojo Central', timezone: 'Europe/Stockholm', address: null },
    ] as Location[]),
}));
vi.mock('../api/members', () => ({
  listMembers: vi.fn().mockResolvedValue([
    { id: 'm1', firstName: 'Ada', lastName: 'Lovelace', email: null, status: 'active' },
    { id: 'm2', firstName: 'Kano', lastName: 'Jigoro', email: null, status: 'active' },
  ] as Member[]),
}));
vi.mock('../api/attendance', () => ({ recordAttendance: vi.fn() }));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/occurrences/o1']}>
        <Routes>
          <Route path="/occurrences/:id" element={<OccurrenceDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OccurrenceDetailPage', () => {
  it('shows the class, its roster, and per-member attendance/booking actions', async () => {
    renderPage();
    // The heading resolves to the occurrence's program name.
    expect(await screen.findByRole('heading', { name: 'Kids BJJ' })).toBeInTheDocument();
    // Roster row: booked member + localized booking status.
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Booked')).toBeInTheDocument();
    // Per-row actions + the occurrence-level cancel.
    expect(screen.getByRole('button', { name: /mark present/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel booking/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel this class/i })).toBeInTheDocument();
  });

  it('offers only un-booked members in the add-member picker', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Kids BJJ' });
    // m1 (Ada) is already booked → not offered; m2 (Kano) is available as an <option>.
    expect(screen.getByRole('option', { name: 'Kano Jigoro' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Ada Lovelace' })).not.toBeInTheDocument();
  });
});
