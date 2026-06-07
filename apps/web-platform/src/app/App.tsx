import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { AuditPage } from '../pages/AuditPage';
import { LoginPage } from '../pages/LoginPage';
import { TenantDetailPage } from '../pages/TenantDetailPage';
import { TenantsPage } from '../pages/TenantsPage';
import { Layout } from './Layout';

/** Gate that waits for the silent-refresh check, then admits or bounces to /login. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <p className="centered">…</p>;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export function App() {
  const { status } = useAuth();
  return (
    <Routes>
      <Route
        path="/login"
        element={status === 'authenticated' ? <Navigate to="/tenants" replace /> : <LoginPage />}
      />
      <Route
        path="/tenants"
        element={
          <RequireAuth>
            <TenantsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/tenants/:slug"
        element={
          <RequireAuth>
            <TenantDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/audit"
        element={
          <RequireAuth>
            <AuditPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/tenants" replace />} />
    </Routes>
  );
}
