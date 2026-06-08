import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcceptInvitePage } from './AcceptInvitePage';

const hoisted = vi.hoisted(() => ({ acceptInvite: vi.fn(), navigate: vi.fn() }));

vi.mock('../auth/auth-context', () => ({
  useAuth: () => ({ acceptInvite: hoisted.acceptInvite }),
}));
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => hoisted.navigate,
}));

afterEach(() => vi.clearAllMocks());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AcceptInvitePage />
    </MemoryRouter>,
  );
}

describe('AcceptInvitePage', () => {
  it('creates the account from the token + password, then navigates to progress', async () => {
    hoisted.acceptInvite.mockResolvedValue(undefined);
    renderAt('/accept-invite?token=inv-1');
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'a-strong-password' },
    });
    fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: 'a-strong-password' } });
    fireEvent.click(screen.getByRole('button', { name: /create my account/i }));

    await waitFor(() =>
      expect(hoisted.acceptInvite).toHaveBeenCalledWith('inv-1', 'a-strong-password'),
    );
    expect(hoisted.navigate).toHaveBeenCalledWith('/progress', { replace: true });
  });

  it('rejects a mismatch client-side without calling accept', async () => {
    renderAt('/accept-invite?token=inv-1');
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'a-strong-password' },
    });
    fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: 'nope-different' } });
    fireEvent.click(screen.getByRole('button', { name: /create my account/i }));
    await screen.findByText(/do not match/i);
    expect(hoisted.acceptInvite).not.toHaveBeenCalled();
  });

  it('surfaces a generic error when the token is rejected', async () => {
    hoisted.acceptInvite.mockRejectedValue(new Error('400'));
    renderAt('/accept-invite?token=bad');
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'a-strong-password' },
    });
    fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: 'a-strong-password' } });
    fireEvent.click(screen.getByRole('button', { name: /create my account/i }));
    await screen.findByText(/invalid or has expired/i);
    expect(hoisted.navigate).not.toHaveBeenCalled();
  });

  it('shows a missing-token message when the link has no token', () => {
    renderAt('/accept-invite');
    expect(screen.getByText(/missing its token/i)).toBeInTheDocument();
  });
});
