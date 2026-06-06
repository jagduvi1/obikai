import type { TenantBillingProfile } from '@obikai/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

// vi.mock is hoisted above module-level consts, so the fixture lives in vi.hoisted.
const { profile } = vi.hoisted(() => ({
  profile: {
    id: 'bp1',
    tenantId: 't1',
    legalName: 'Aikido Stockholm AB',
    vatId: 'SE556677889901',
    registrationNumber: '556677-8899',
    addressLine1: 'Mästersamuelsgatan 1',
    addressLine2: null,
    postalCode: '111 44',
    city: 'Stockholm',
    country: 'SE',
    email: 'billing@aikido.example',
    paymentDetails: null,
    footerNote: null,
    createdAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:00.000Z',
  } as TenantBillingProfile,
}));

vi.mock('../api/settings', () => ({
  getBillingProfile: vi.fn().mockResolvedValue(profile),
  saveBillingProfile: vi.fn(),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

describe('SettingsPage', () => {
  it('pre-fills the form from the saved billing profile', async () => {
    renderPage();
    // The legal-name field is labelled and populated once the profile loads.
    const legalName = await screen.findByLabelText(/legal name/i);
    await waitFor(() => expect(legalName).toHaveValue('Aikido Stockholm AB'));
    expect(screen.getByLabelText(/vat number/i)).toHaveValue('SE556677889901');
    expect(screen.getByLabelText(/country/i)).toHaveValue('SE');
    expect(screen.getByRole('heading', { name: /billing profile/i })).toBeInTheDocument();
  });
});
