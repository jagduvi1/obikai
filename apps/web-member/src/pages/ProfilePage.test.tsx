import type { Member } from '@obikai/domain';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithSubject } from '../test/render';
import { ProfilePage } from './ProfilePage';

const { getMe, getDependents, getMyProfile, updateMyProfile } = vi.hoisted(() => ({
  getMe: vi.fn(),
  getDependents: vi.fn(),
  getMyProfile: vi.fn(),
  updateMyProfile: vi.fn(),
}));
vi.mock('../api/member-data', () => ({ getMe, getDependents, getMyProfile, updateMyProfile }));

const member = (over: Partial<Record<keyof Member, unknown>> = {}): Member =>
  ({
    id: 'm1',
    tenantId: 't1',
    userId: 'u1',
    householdId: null,
    firstName: 'Aiko',
    lastName: 'Tanaka',
    email: 'aiko@x.io',
    phone: null,
    dateOfBirth: null,
    status: 'active',
    joinDate: null,
    emergencyContact: null,
    notes: null,
    tags: [],
    createdAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:00.000Z',
    ...over,
  }) as Member;

function renderPage() {
  return renderWithSubject(<ProfilePage />);
}

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    getMe.mockResolvedValue({ userId: 'u1', memberId: 'm1', roles: [] });
    getDependents.mockResolvedValue([]);
  });

  it('pre-fills from the loaded profile and saves the edited contact fields', async () => {
    getMyProfile.mockResolvedValue(member());
    updateMyProfile.mockResolvedValue(member({ phone: '555-1' }));
    const user = userEvent.setup();
    renderPage();

    const first = (await screen.findByLabelText(/first name/i)) as HTMLInputElement;
    expect(first.value).toBe('Aiko');

    // Two "Phone" inputs (member + emergency contact); [0] is the member's own, grouped separately.
    await user.type(screen.getAllByLabelText('Phone')[0] as HTMLElement, '555-1');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updateMyProfile).toHaveBeenCalledTimes(1));
    expect(updateMyProfile.mock.calls[0]?.[0]).toMatchObject({
      firstName: 'Aiko',
      lastName: 'Tanaka',
      email: 'aiko@x.io',
      phone: '555-1',
      emergencyContact: null,
    });
  });

  it('shows a guardian-only note (no profile fetch) for a non-member parent account', async () => {
    getMe.mockResolvedValue({ userId: 'u1', memberId: null, roles: [] });
    getDependents.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/guardian account, not a club member/i)).toBeInTheDocument();
    expect(getMyProfile).not.toHaveBeenCalled();
  });
});
