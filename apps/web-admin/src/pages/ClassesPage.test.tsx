import type { ClassSchedule, Location, Program } from '@obikai/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ClassesPage } from './ClassesPage';

vi.mock('../api/scheduling', () => ({
  listPrograms: vi
    .fn()
    .mockResolvedValue([
      { id: 'p1', name: 'Kids BJJ', disciplineId: null, active: true },
    ] as Program[]),
  listSchedules: vi.fn().mockResolvedValue([
    {
      id: 's1',
      programId: 'p1',
      locationId: 'l1',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
      startTime: '18:00',
      durationMin: 60,
      capacity: 20,
      timezone: 'Europe/Stockholm',
      active: true,
    },
  ] as ClassSchedule[]),
  createProgram: vi.fn(),
  createSchedule: vi.fn(),
  materializeSchedule: vi.fn(),
}));
vi.mock('../api/locations', () => ({
  listLocations: vi
    .fn()
    .mockResolvedValue([
      { id: 'l1', name: 'Dojo Central', timezone: 'Europe/Stockholm', address: null },
    ] as Location[]),
}));
vi.mock('../api/rank', () => ({
  listDisciplines: vi.fn().mockResolvedValue([]),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ClassesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ClassesPage', () => {
  it('renders programs and schedules with resolved names and localized weekdays', async () => {
    renderPage();
    // The recurrence cell renders the RRULE's BYDAY as localized weekdays — unique to the table.
    expect(await screen.findByText(/Mon Wed/)).toBeInTheDocument();
    // The program name appears in the program table, the schedule's program <option>, and the
    // schedule table's resolved program cell — so it is legitimately present multiple times.
    expect(screen.getAllByText('Kids BJJ').length).toBeGreaterThan(0);
    // Accessible structure: the two section headings.
    expect(screen.getByRole('heading', { name: /programs/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /schedules/i })).toBeInTheDocument();
  });

  it('starts with an empty recurrence preview until weekdays are chosen', async () => {
    renderPage();
    await screen.findByText(/Mon Wed/);
    // The rule preview shows the em-dash placeholder in its <code> until a weekday is selected.
    expect(screen.getByText('—', { selector: 'code' })).toBeInTheDocument();
  });
});
