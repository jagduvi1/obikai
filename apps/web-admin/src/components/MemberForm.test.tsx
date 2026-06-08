import type { MemberCreateInput } from '@obikai/domain';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemberForm } from './MemberForm';

describe('MemberForm', () => {
  it('pre-fills from initial values (edit case) and emits the trimmed, null-normalized input', () => {
    const onSubmit = vi.fn<(input: MemberCreateInput) => void>();
    render(
      <MemberForm
        initial={{
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@x.io',
          phone: '',
          status: 'active',
          notes: '  keen  ',
          tags: ' competitor , kids ',
        }}
        submitLabel="Save changes"
        pending={false}
        error={false}
        onSubmit={onSubmit}
      />,
    );
    // Pre-filled.
    expect((screen.getByLabelText(/first name/i) as HTMLInputElement).value).toBe('Ada');
    expect((screen.getByLabelText(/status/i) as HTMLSelectElement).value).toBe('active');

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@x.io',
      phone: null, // blank → null
      dateOfBirth: null,
      status: 'active',
      notes: 'keen', // trimmed
      tags: ['competitor', 'kids'], // comma-split + trimmed
    });
  });

  it('does not submit while required names are missing', () => {
    const onSubmit = vi.fn();
    render(
      <MemberForm submitLabel="Create member" pending={false} error={false} onSubmit={onSubmit} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /create member/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows an error region when error is set', () => {
    render(
      <MemberForm submitLabel="Save changes" pending={false} error={true} onSubmit={() => {}} />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
