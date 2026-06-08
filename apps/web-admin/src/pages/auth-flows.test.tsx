import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';
import { VerifyEmailPage } from './VerifyEmailPage';

const mocks = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  confirmPasswordReset: vi.fn(),
  confirmEmailVerification: vi.fn(),
}));

vi.mock('@obikai/api-client', () => mocks);

afterEach(() => vi.clearAllMocks());

function renderAt(node: React.ReactNode, path = '/') {
  return render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);
}

describe('ForgotPasswordPage', () => {
  it('submits the email and shows a neutral "check your inbox" message (no enumeration)', async () => {
    mocks.requestPasswordReset.mockResolvedValue(undefined);
    renderAt(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.io' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await screen.findByText(/a reset link is on its way/i);
    expect(mocks.requestPasswordReset).toHaveBeenCalledWith('a@x.io');
  });

  it('still shows the success message even if the request rejects (no leak)', async () => {
    mocks.requestPasswordReset.mockRejectedValue(new Error('boom'));
    renderAt(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.io' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await screen.findByText(/a reset link is on its way/i);
  });
});

describe('ResetPasswordPage', () => {
  it('sets a new password with the token from the query and shows success', async () => {
    mocks.confirmPasswordReset.mockResolvedValue(undefined);
    renderAt(<ResetPasswordPage />, '/reset-password?token=tok-123');
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'a-strong-password' },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'a-strong-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /set new password/i }));
    await screen.findByText(/your password has been changed/i);
    expect(mocks.confirmPasswordReset).toHaveBeenCalledWith('tok-123', 'a-strong-password');
  });

  it('rejects a mismatch client-side without calling the API', async () => {
    renderAt(<ResetPasswordPage />, '/reset-password?token=tok-123');
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'a-strong-password' },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'different-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /set new password/i }));
    await screen.findByText(/do not match/i);
    expect(mocks.confirmPasswordReset).not.toHaveBeenCalled();
  });

  it('shows a missing-token message when the link has no token', () => {
    renderAt(<ResetPasswordPage />, '/reset-password');
    expect(screen.getByText(/missing its token/i)).toBeInTheDocument();
  });

  it('surfaces a generic error when the token is rejected', async () => {
    mocks.confirmPasswordReset.mockRejectedValue(new Error('400'));
    renderAt(<ResetPasswordPage />, '/reset-password?token=bad');
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'a-strong-password' },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'a-strong-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /set new password/i }));
    await screen.findByText(/invalid or has expired/i);
  });
});

describe('VerifyEmailPage', () => {
  it('confirms the token on mount and shows success', async () => {
    mocks.confirmEmailVerification.mockResolvedValue(undefined);
    renderAt(<VerifyEmailPage />, '/verify-email?token=v-1');
    await screen.findByText(/your email is confirmed/i);
    expect(mocks.confirmEmailVerification).toHaveBeenCalledWith('v-1');
  });

  it('shows an error when the token is invalid', async () => {
    mocks.confirmEmailVerification.mockRejectedValue(new Error('400'));
    renderAt(<VerifyEmailPage />, '/verify-email?token=bad');
    await screen.findByText(/invalid or has expired/i);
  });

  it('shows an error when the link has no token (no API call)', async () => {
    renderAt(<VerifyEmailPage />, '/verify-email');
    await waitFor(() => expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument());
    expect(mocks.confirmEmailVerification).not.toHaveBeenCalled();
  });
});
