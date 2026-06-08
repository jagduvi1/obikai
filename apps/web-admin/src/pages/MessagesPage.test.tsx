import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagesPage } from './MessagesPage';

const { sendBroadcast } = vi.hoisted(() => ({ sendBroadcast: vi.fn() }));
vi.mock('../api/messages', () => ({ sendBroadcast }));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MessagesPage />
    </QueryClientProvider>,
  );
}

describe('MessagesPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('composes and sends a transactional broadcast to all members, then shows the summary', async () => {
    sendBroadcast.mockResolvedValue({
      broadcastId: 'b1',
      total: 3,
      sent: 2,
      failed: 0,
      skippedNoContact: 1,
      skippedNoConsent: 0,
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Subject'), 'Open mat Saturday');
    await user.type(screen.getByLabelText('Message'), 'Come train!');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(sendBroadcast).toHaveBeenCalledTimes(1));
    expect(sendBroadcast.mock.calls[0]?.[0]).toMatchObject({
      segment: { kind: 'all' },
      category: 'transactional',
      channel: 'email',
      subject: 'Open mat Saturday',
      body: 'Come train!',
    });
    // The delivery summary renders.
    expect(await screen.findByText(/sent to 2 of 3/i)).toBeInTheDocument();
  });

  it('switches the audience to a tag segment', async () => {
    sendBroadcast.mockResolvedValue({
      broadcastId: 'b2',
      total: 1,
      sent: 1,
      failed: 0,
      skippedNoContact: 0,
      skippedNoConsent: 0,
    });
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText(/audience/i), 'tag');
    await user.type(screen.getByLabelText(/^tag$/i), 'competitor');
    await user.type(screen.getByLabelText('Subject'), 'Comp team');
    await user.type(screen.getByLabelText('Message'), 'Meet at 6.');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(sendBroadcast).toHaveBeenCalledTimes(1));
    expect(sendBroadcast.mock.calls[0]?.[0]).toMatchObject({
      segment: { kind: 'tag', tag: 'competitor' },
    });
  });
});
