import type { OwnerDashboard } from '@obikai/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage';

const { getOwnerDashboard } = vi.hoisted(() => ({ getOwnerDashboard: vi.fn() }));
vi.mock('../api/reporting', () => ({ getOwnerDashboard }));

const dashboard = (): OwnerDashboard => ({
  members: {
    active: 42,
    newThisMonth: 5,
    byStatus: [
      { status: 'active', count: 42 },
      { status: 'trial', count: 7 },
    ],
  },
  revenue: {
    mrr: [{ currency: 'SEK', amountMinor: 2_000_00 }],
    outstanding: [{ currency: 'SEK', amountMinor: 500_00 }],
    outstandingCount: 3,
    toRecover: 2,
  },
  atRisk: 4,
  attendanceTrend: [
    { month: '2026-05', count: 30 },
    { month: '2026-06', count: 45 },
  ],
  generatedAt: '2026-06-15T12:00:00.000Z',
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

describe('DashboardPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the action cards and attendance trend from the dashboard payload', async () => {
    getOwnerDashboard.mockResolvedValue(dashboard());
    renderPage();

    // Headline + action numbers.
    expect(await screen.findByText('42')).toBeInTheDocument(); // active members
    expect(screen.getByText('4')).toBeInTheDocument(); // at-risk
    expect(screen.getByText('2')).toBeInTheDocument(); // to recover
    expect(screen.getByText(/members at risk/i)).toBeInTheDocument();
    // The attendance trend rows render.
    expect(screen.getByText('2026-06')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
  });

  it('shows an error state when the dashboard fails to load', async () => {
    getOwnerDashboard.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText(/could not load the dashboard/i)).toBeInTheDocument();
  });
});
