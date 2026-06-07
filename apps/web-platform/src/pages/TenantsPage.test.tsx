import type { Tenant } from '@obikai/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TenantsPage } from './TenantsPage';

vi.mock('../api/platform', () => ({
  listTenants: vi.fn().mockResolvedValue([
    {
      id: 'aikido-sthlm',
      slug: 'aikido-sthlm',
      name: 'Aikido Stockholm',
      status: 'active',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
    {
      id: 'bjj-oslo',
      slug: 'bjj-oslo',
      name: 'BJJ Oslo',
      status: 'suspended',
      createdAt: '2026-02-03T00:00:00.000Z',
      updatedAt: '2026-02-03T00:00:00.000Z',
    },
  ] as Tenant[]),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TenantsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TenantsPage', () => {
  it('lists tenants with localized status and a link to each detail', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'aikido-sthlm' });
    expect(link).toHaveAttribute('href', '/tenants/aikido-sthlm');
    expect(screen.getByText('Aikido Stockholm')).toBeInTheDocument();
    expect(screen.getByText('Suspended')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /tenants/i })).toBeInTheDocument();
  });
});
