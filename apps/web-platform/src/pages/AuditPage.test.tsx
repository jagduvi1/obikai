import type { PlatformAuditEntry } from '@obikai/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuditPage } from './AuditPage';

// Chain order (oldest → newest) as the api returns it.
vi.mock('../api/platform', () => ({
  listAudit: vi.fn().mockResolvedValue([
    {
      id: 'a1',
      ts: 1_750_000_000_000,
      actorUserId: 'admin-1',
      action: 'tenant.list',
      targetType: 'tenant',
      targetId: '*',
      ip: '203.0.113.7',
      prevHash: null,
      hash: 'h1',
    },
    {
      id: 'a2',
      ts: 1_750_000_100_000,
      actorUserId: 'admin-1',
      action: 'tenant.usage.read',
      targetType: 'tenant',
      targetId: 'aikido-sthlm',
      ip: '203.0.113.7',
      prevHash: 'h1',
      hash: 'h2',
    },
  ] as PlatformAuditEntry[]),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuditPage />
    </QueryClientProvider>,
  );
}

describe('AuditPage', () => {
  it('renders audit entries newest-first with action + target', async () => {
    renderPage();
    expect(await screen.findByText('tenant.usage.read')).toBeInTheDocument();
    expect(screen.getByText('aikido-sthlm')).toBeInTheDocument();

    // Newest (tenant.usage.read) appears before the older genesis (tenant.list) in the table body.
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    // rows[0] is the header; rows[1] is the newest entry.
    expect(within(rows[1] as HTMLElement).getByText('tenant.usage.read')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('tenant.list')).toBeInTheDocument();
  });
});
