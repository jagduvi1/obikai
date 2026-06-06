import type { Member } from '@obikai/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MembersPage } from './MembersPage';

vi.mock('../api/members', () => ({
  listMembers: vi.fn().mockResolvedValue([
    { id: 'm1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@x.io', status: 'active' },
    { id: 'm2', firstName: 'Kanō', lastName: 'Jigorō', email: null, status: 'lead' },
  ] as Member[]),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MembersPage />
    </QueryClientProvider>,
  );
}

describe('MembersPage', () => {
  it('renders members returned by the api in an accessible table', async () => {
    renderPage();
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Kanō Jigorō')).toBeInTheDocument();
    // Null email renders the em-dash placeholder.
    expect(screen.getByText('—')).toBeInTheDocument();
    // Accessible: a column header + a region labelled by the heading.
    expect(screen.getByRole('columnheader', { name: /name/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /members/i })).toBeInTheDocument();
  });
});
