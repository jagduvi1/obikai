import { configureApiBase } from '@obikai/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { AuthProvider } from './auth/auth-context';
import './i18n';
// Shared design-system tokens + font + base element styling. Imported first so the
// app's own styles.css can layer surface-specific rules on top of the foundation.
import '@obikai/ui/styles.css';
import './styles.css';

// Point the shared client at this deployment's api (dev: Vite-proxied `/api`). Platform endpoints
// live under `/platform/*` on the same api (ADR-0022); the access token is tenant-independent.
configureApiBase(import.meta.env.VITE_API_URL ?? '/api');

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
