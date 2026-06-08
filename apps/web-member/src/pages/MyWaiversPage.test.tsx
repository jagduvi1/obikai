import type { MemberWaiverStatus } from '@obikai/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MyWaiversPage } from './MyWaiversPage';

const { getMe, myWaiverStatus, signWaiver } = vi.hoisted(() => ({
  getMe: vi.fn(),
  myWaiverStatus: vi.fn(),
  signWaiver: vi.fn(),
}));

vi.mock('../api/member-data', () => ({ getMe, myWaiverStatus, signWaiver }));

/** A pending (unsigned) active template, version 1. */
// Branded IDs (WaiverTemplateId etc.) are nominal, so the fixtures use an `as` assertion — the same
// pattern as the other member-page tests (MyProgressPage.test).
const pendingWaiver = () =>
  ({
    template: {
      id: 'wt1',
      tenantId: 't1',
      title: 'Liability Waiver',
      bodyMarkdown: 'I accept the risks of training.\n\nI release the dojo from liability.',
      version: 1,
      requiresGuardianForMinor: true,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    signed: false,
    signature: null,
  }) as MemberWaiverStatus;

const signedWaiver = () =>
  ({
    template: {
      id: 'wt2',
      tenantId: 't1',
      title: 'Media Consent',
      bodyMarkdown: 'Photos may be used.',
      version: 2,
      requiresGuardianForMinor: false,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
    signed: true,
    signature: {
      id: 'ws1',
      tenantId: 't1',
      templateId: 'wt2',
      templateVersion: 2,
      memberId: 'm1',
      signedByUserId: 'u1',
      signedByName: 'Aiko Tanaka',
      isGuardian: false,
      guardianForMemberId: null,
      signedAt: '2026-03-04T10:00:00.000Z',
      ip: null,
      documentStorageKey: null,
      createdAt: '2026-03-04T10:00:00.000Z',
    },
  }) as MemberWaiverStatus;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MyWaiversPage />
    </QueryClientProvider>,
  );
}

describe('MyWaiversPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMe.mockResolvedValue({ userId: 'u1', memberId: 'm1', roles: [] });
  });

  it('shows pending waivers with a sign form and signed waivers as history', async () => {
    myWaiverStatus.mockResolvedValue([pendingWaiver(), signedWaiver()]);
    renderPage();

    // Pending: title + body paragraphs + the sign form controls.
    expect(await screen.findByRole('heading', { name: /Liability Waiver/ })).toBeInTheDocument();
    expect(screen.getByText(/I accept the risks of training/)).toBeInTheDocument();
    expect(screen.getByLabelText(/your full name/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();

    // Signed history shows the other waiver with its signed date.
    expect(screen.getByRole('heading', { name: /Signed waivers/i })).toBeInTheDocument();
    expect(screen.getByText('Media Consent')).toBeInTheDocument();
  });

  it('blocks signing until name + agreement are provided, then submits', async () => {
    const user = userEvent.setup();
    myWaiverStatus.mockResolvedValue([pendingWaiver()]);
    signWaiver.mockResolvedValue({ id: 'ws9' });
    renderPage();

    const signButton = await screen.findByRole('button', { name: /sign waiver/i });

    // No name → validation error, no API call.
    await user.click(signButton);
    expect(screen.getByText(/type your full name/i)).toBeInTheDocument();
    expect(signWaiver).not.toHaveBeenCalled();

    // Name but no agreement → still blocked.
    await user.type(screen.getByLabelText(/your full name/i), 'Aiko Tanaka');
    await user.click(signButton);
    expect(screen.getByText(/confirm you have read and agree/i)).toBeInTheDocument();
    expect(signWaiver).not.toHaveBeenCalled();

    // Agree → submits with the typed name and self memberId.
    await user.click(screen.getByRole('checkbox'));
    await user.click(signButton);
    await waitFor(() =>
      expect(signWaiver).toHaveBeenCalledWith({
        templateId: 'wt1',
        memberId: 'm1',
        signedByName: 'Aiko Tanaka',
        isGuardian: false,
      }),
    );
  });

  it('confirms when every current waiver is already signed', async () => {
    myWaiverStatus.mockResolvedValue([signedWaiver()]);
    renderPage();
    expect(await screen.findByText(/signed all current waivers/i)).toBeInTheDocument();
  });
});
