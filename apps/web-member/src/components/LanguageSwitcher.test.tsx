import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

// A deterministic in-memory localStorage (the jsdom/Node-22 global is flaky in this runner).
function stubLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

beforeEach(stubLocalStorage);
afterEach(async () => {
  await i18n.changeLanguage('en');
  vi.unstubAllGlobals();
});

describe('LanguageSwitcher', () => {
  it('lists locales by native name and switches language, <html lang>, and persistence', async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);

    const select = screen.getByRole('combobox', { name: /language/i });
    // Endonyms, not English names.
    expect(screen.getByRole('option', { name: 'Svenska' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Norsk bokmål' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();

    await user.selectOptions(select, 'sv');

    await waitFor(() => expect(i18n.language).toBe('sv'));
    expect(document.documentElement.lang).toBe('sv');
    expect(localStorage.getItem('obikai.locale')).toBe('sv');
  });
});
