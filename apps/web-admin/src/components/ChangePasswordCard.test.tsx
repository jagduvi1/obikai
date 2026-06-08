import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangePasswordCard } from './ChangePasswordCard';

const mocks = vi.hoisted(() => ({ changePassword: vi.fn() }));
vi.mock('@obikai/api-client', () => mocks);
afterEach(() => vi.clearAllMocks());

function fill(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: next } });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: confirm } });
}

describe('ChangePasswordCard', () => {
  it('proves the current password and submits a new one', async () => {
    mocks.changePassword.mockResolvedValue({ accessToken: 'a', accessExpiresAt: 'b' });
    render(<ChangePasswordCard />);
    fill('old-password-12', 'a-brand-new-password', 'a-brand-new-password');
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));
    await screen.findByText(/your password has been changed/i);
    expect(mocks.changePassword).toHaveBeenCalledWith('old-password-12', 'a-brand-new-password');
  });

  it('rejects a mismatch client-side', async () => {
    render(<ChangePasswordCard />);
    fill('old-password-12', 'a-brand-new-password', 'nope-different');
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));
    await screen.findByText(/do not match/i);
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it('shows an error when the API rejects (wrong current password)', async () => {
    mocks.changePassword.mockRejectedValue(new Error('401'));
    render(<ChangePasswordCard />);
    fill('wrong-current', 'a-brand-new-password', 'a-brand-new-password');
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));
    await screen.findByText(/could not change your password/i);
  });
});
