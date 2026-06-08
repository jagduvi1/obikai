import type { Discipline } from '@obikai/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DisciplinesPage } from './DisciplinesPage';

const { listDisciplines, createDiscipline } = vi.hoisted(() => ({
  listDisciplines: vi.fn(),
  createDiscipline: vi.fn(),
}));
vi.mock('../api/rank', () => ({ listDisciplines, createDiscipline }));

afterEach(() => vi.clearAllMocks());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DisciplinesPage />
    </QueryClientProvider>,
  );
}

describe('DisciplinesPage (H4 translatable names)', () => {
  it('renders a discipline name resolved to the viewer locale', async () => {
    listDisciplines.mockResolvedValue([
      {
        id: 'd1',
        name: { en: 'Brazilian Jiu-Jitsu', sv: 'Brasiliansk jiu-jitsu' },
        presentation: 'belt',
        active: true,
      } as Discipline,
    ]);
    renderPage();
    // The default test locale is English → the English name shows.
    expect(await screen.findByText('Brazilian Jiu-Jitsu')).toBeInTheDocument();
  });

  it('authors a multi-locale name (English + Swedish) and posts a LocalizedString', async () => {
    const user = userEvent.setup();
    listDisciplines.mockResolvedValue([]);
    createDiscipline.mockResolvedValue({ id: 'd2' });
    renderPage();

    await user.type(screen.getByRole('textbox', { name: 'English' }), 'Karate');
    await user.type(screen.getByRole('textbox', { name: 'Svenska' }), 'Karate (sv)');
    await user.click(screen.getByRole('button', { name: /add discipline/i }));

    await waitFor(() =>
      expect(createDiscipline).toHaveBeenCalledWith({
        name: { en: 'Karate', sv: 'Karate (sv)' },
        presentation: 'belt',
        active: true,
      }),
    );
  });
});
