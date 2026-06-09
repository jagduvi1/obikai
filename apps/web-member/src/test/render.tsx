import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { SubjectProvider } from '../subject/subject-context';

/**
 * Render a member-app page inside the providers it expects: a fresh React Query client (retries off)
 * and the SubjectProvider (whose data comes from the test's mocked `../api/member-data`). Tests that
 * use this must mock `getMe` and `getDependents` so the provider can resolve the active subject.
 */
export function renderWithSubject(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SubjectProvider>{ui}</SubjectProvider>
    </QueryClientProvider>,
  );
}
