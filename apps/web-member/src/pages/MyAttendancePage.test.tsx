import type { Attendance } from '@obikai/domain';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithSubject } from '../test/render';
import { MyAttendancePage } from './MyAttendancePage';

const { getMe, getDependents, myAttendance } = vi.hoisted(() => ({
  getMe: vi.fn(),
  getDependents: vi.fn(),
  myAttendance: vi.fn(),
}));
vi.mock('../api/member-data', () => ({ getMe, getDependents, myAttendance }));

const row = (over: Partial<Record<keyof Attendance, unknown>> = {}) =>
  ({
    id: 'a1',
    tenantId: 't1',
    memberId: 'm1',
    occurrenceId: 'occ1',
    programId: 'prog1',
    disciplineId: 'disc1',
    locationId: 'loc1',
    occurredAt: '2026-06-10T16:30:00.000Z',
    method: 'self',
    createdAt: '2026-06-10T16:30:00.000Z',
    ...over,
  }) as Attendance;

function renderPage() {
  return renderWithSubject(<MyAttendancePage />);
}

describe('MyAttendancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    getMe.mockResolvedValue({ userId: 'u1', memberId: 'm1', roles: [] });
    getDependents.mockResolvedValue([]);
  });

  it('lists check-ins with the translated method', async () => {
    myAttendance.mockResolvedValue([
      row({ method: 'self' }),
      row({ id: 'a2', method: 'instructor' }),
    ]);
    renderPage();
    expect(await screen.findByText('You')).toBeInTheDocument();
    expect(screen.getByText('Instructor')).toBeInTheDocument();
  });

  it('shows an empty state when there is no attendance', async () => {
    myAttendance.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/no attendance recorded/i)).toBeInTheDocument();
  });
});
