import type { Member } from '@obikai/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubjectSwitcher } from '../components/SubjectSwitcher';
import { SubjectProvider, useSubject } from './subject-context';

const { getMe, getDependents } = vi.hoisted(() => ({ getMe: vi.fn(), getDependents: vi.fn() }));
vi.mock('../api/member-data', () => ({ getMe, getDependents }));

const child = (id: string, first: string): Member =>
  ({ id, firstName: first, lastName: 'Karlsson' }) as unknown as Member;

/** Probe that surfaces the active subject so tests can assert on the provider's resolution. */
function Probe() {
  const { activeMemberId, active } = useSubject();
  return (
    <p>
      active:{activeMemberId ?? 'none'}/{active?.isSelf ? 'self' : (active?.name ?? '')}
    </p>
  );
}

function renderHarness() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SubjectProvider>
        <SubjectSwitcher />
        <Probe />
      </SubjectProvider>
    </QueryClientProvider>,
  );
}

describe('SubjectProvider + SubjectSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('hides the switcher and defaults to self for a plain member with no children', async () => {
    getMe.mockResolvedValue({ userId: 'u1', memberId: 'm1', roles: [] });
    getDependents.mockResolvedValue([]);
    renderHarness();

    await waitFor(() => expect(screen.getByText('active:m1/self')).toBeInTheDocument());
    // A single subject → nothing to switch between.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('lets a member-parent switch between themselves and a child', async () => {
    getMe.mockResolvedValue({ userId: 'u1', memberId: 'm1', roles: [] });
    getDependents.mockResolvedValue([child('kid1', 'Wilma')]);
    const user = userEvent.setup();
    renderHarness();

    // Defaults to self (own record listed first).
    await waitFor(() => expect(screen.getByText('active:m1/self')).toBeInTheDocument());
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Me' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Wilma Karlsson' })).toBeInTheDocument();

    await user.selectOptions(select, 'kid1');
    await waitFor(() => expect(screen.getByText('active:kid1/Wilma Karlsson')).toBeInTheDocument());
  });

  it('defaults a guardian-only parent (no own record) to their first child', async () => {
    getMe.mockResolvedValue({ userId: 'u1', memberId: null, roles: [] });
    getDependents.mockResolvedValue([child('kid1', 'Wilma'), child('kid2', 'Noah')]);
    renderHarness();

    await waitFor(() => expect(screen.getByText('active:kid1/Wilma Karlsson')).toBeInTheDocument());
    // Two children, no "Me" option.
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Me' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Noah Karlsson' })).toBeInTheDocument();
  });
});
