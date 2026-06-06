import type { Location } from '@obikai/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LocationsPage } from './LocationsPage';

vi.mock('../api/locations', () => ({
  listLocations: vi.fn().mockResolvedValue([
    { id: 'l1', name: 'Dojo Central', timezone: 'Europe/Stockholm', address: 'Main St 1' },
    { id: 'l2', name: 'Dojo North', timezone: 'Europe/Oslo', address: null },
  ] as Location[]),
  createLocation: vi.fn(),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocationsPage />
    </QueryClientProvider>,
  );
}

describe('LocationsPage', () => {
  it('renders locations in an accessible table with a null-address placeholder', async () => {
    renderPage();
    expect(await screen.findByText('Dojo Central')).toBeInTheDocument();
    expect(screen.getByText('Dojo North')).toBeInTheDocument();
    expect(screen.getByText('Europe/Oslo')).toBeInTheDocument();
    // Null address renders the em-dash placeholder.
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /timezone/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /locations/i })).toBeInTheDocument();
  });
});
