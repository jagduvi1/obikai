import type { WaiverTemplate } from '@obikai/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WaiversPage } from './WaiversPage';

const mocks = vi.hoisted(() => ({
  listWaiverTemplates: vi.fn(),
  createWaiverTemplate: vi.fn(),
  updateWaiverTemplate: vi.fn(),
}));
vi.mock('../api/waivers', () => mocks);
afterEach(() => vi.clearAllMocks());

const template = (over: Partial<WaiverTemplate> = {}): WaiverTemplate =>
  ({
    id: 'w1',
    tenantId: 't1',
    title: 'Liability Waiver',
    bodyMarkdown: 'I agree…',
    version: 2,
    requiresGuardianForMinor: true,
    active: true,
    createdAt: 'x',
    updatedAt: 'x',
    ...over,
  }) as WaiverTemplate;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WaiversPage />
    </QueryClientProvider>,
  );
}

describe('WaiversPage', () => {
  it('lists templates with their version + status', async () => {
    mocks.listWaiverTemplates.mockResolvedValue([template()]);
    renderPage();
    expect(await screen.findByText('Liability Waiver')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /waivers/i })).toBeInTheDocument();
  });

  it('creates a template from the form', async () => {
    mocks.listWaiverTemplates.mockResolvedValue([]);
    mocks.createWaiverTemplate.mockResolvedValue(template());
    renderPage();
    await screen.findByText(/no waivers yet/i);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Photo consent' } });
    fireEvent.change(screen.getByLabelText(/waiver text/i), { target: { value: 'I consent…' } });
    fireEvent.click(screen.getByRole('button', { name: /add waiver/i }));
    await waitFor(() => expect(mocks.createWaiverTemplate).toHaveBeenCalledTimes(1));
    expect(mocks.createWaiverTemplate.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        title: 'Photo consent',
        bodyMarkdown: 'I consent…',
        requiresGuardianForMinor: true,
        active: true,
      }),
    );
  });

  it('toggles a template active/inactive via PATCH', async () => {
    mocks.listWaiverTemplates.mockResolvedValue([template({ active: true })]);
    mocks.updateWaiverTemplate.mockResolvedValue(template({ active: false }));
    renderPage();
    await screen.findByText('Liability Waiver');
    fireEvent.click(screen.getByRole('button', { name: /deactivate/i }));
    await waitFor(() =>
      expect(mocks.updateWaiverTemplate).toHaveBeenCalledWith('w1', { active: false }),
    );
  });
});
