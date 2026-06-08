import type { Member } from '@obikai/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MembersPage } from './MembersPage';

const mocks = vi.hoisted(() => ({
  listMembers: vi.fn(),
  createMember: vi.fn(),
}));

vi.mock('../api/members', () => mocks);

afterEach(() => vi.clearAllMocks());

/** A full Member fixture (all required fields) with per-test overrides (branded ids loosened). */
function member(over: Partial<Record<keyof Member, unknown>>): Member {
  return {
    id: 'm',
    tenantId: 't1',
    userId: null,
    householdId: null,
    firstName: 'First',
    lastName: 'Last',
    email: null,
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
  } as Member;
}

function renderPage() {
  mocks.listMembers.mockResolvedValue([
    member({
      id: 'm1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@x.io',
      status: 'active',
      tags: ['competitor'],
    }),
    member({ id: 'm2', firstName: 'Kanō', lastName: 'Jigorō', status: 'lead', tags: ['kids'] }),
  ]);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MembersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MembersPage', () => {
  it('renders members returned by the api in an accessible table', async () => {
    renderPage();
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Kanō Jigorō')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /name/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /members/i })).toBeInTheDocument();
  });

  it('reveals the add-member form and creates a member with the converted input', async () => {
    mocks.createMember.mockResolvedValue({ id: 'm3' } as Member);
    renderPage();
    await screen.findByText('Ada Lovelace');

    fireEvent.click(screen.getByRole('button', { name: /add member/i }));
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Mei' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Tan' } });
    // Leave email blank → sent as null.
    fireEvent.click(screen.getByRole('button', { name: /create member/i }));

    await waitFor(() => expect(mocks.createMember).toHaveBeenCalledTimes(1));
    // Assert on the first argument only (React Query may pass internal context as a second arg).
    expect(mocks.createMember.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ firstName: 'Mei', lastName: 'Tan', email: null, status: 'lead' }),
    );
  });

  it('keeps the create button disabled until first + last name are filled', async () => {
    renderPage();
    await screen.findByText('Ada Lovelace');
    fireEvent.click(screen.getByRole('button', { name: /add member/i }));
    const submit = screen.getByRole('button', { name: /create member/i });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Mei' } });
    expect(submit).toBeDisabled(); // last name still empty
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Tan' } });
    expect(submit).toBeEnabled();
  });
});
