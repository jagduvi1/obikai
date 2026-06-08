import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('LanguageSwitcher (admin)', () => {
  it('offers locales by native name and switches language + <html lang>', async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);

    const select = screen.getByRole('combobox', { name: /language/i });
    expect(screen.getByRole('option', { name: 'Svenska' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();

    await user.selectOptions(select, 'sv');
    await waitFor(() => expect(i18n.language).toBe('sv'));
    expect(document.documentElement.lang).toBe('sv');
  });
});
