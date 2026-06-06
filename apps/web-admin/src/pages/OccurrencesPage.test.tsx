import type { ClassOccurrence, Location, Program } from '@obikai/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { OccurrencesPage } from './OccurrencesPage';

vi.mock('../api/scheduling', () => ({
  listOccurrences: vi.fn().mockResolvedValue([
    {
      id: 'o1',
      scheduleId: 's1',
      programId: 'p1',
      locationId: 'l1',
      startsAt: '2026-06-10T16:00:00.000Z',
      endsAt: '2026-06-10T17:00:00.000Z',
      capacity: 20,
      status: 'scheduled',
    },
  ] as ClassOccurrence[]),
  listPrograms: vi
    .fn()
    .mockResolvedValue([
      { id: 'p1', name: 'Kids BJJ', disciplineId: null, active: true },
    ] as Program[]),
}));
vi.mock('../api/locations', () => ({
  listLocations: vi
    .fn()
    .mockResolvedValue([
      { id: 'l1', name: 'Dojo Central', timezone: 'Europe/Stockholm', address: null },
    ] as Location[]),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OccurrencesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OccurrencesPage', () => {
  it('lists occurrences with resolved program/location names and a link to the roster', async () => {
    renderPage();
    // The program name appears in the row; the location in both the filter <option> and the row.
    expect(await screen.findByText('Kids BJJ')).toBeInTheDocument();
    expect(screen.getAllByText('Dojo Central').length).toBeGreaterThan(0);
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    // The time cell is a link to the occurrence detail.
    const link = screen.getByRole('link', { name: /2026/ });
    expect(link).toHaveAttribute('href', '/occurrences/o1');
  });
});
