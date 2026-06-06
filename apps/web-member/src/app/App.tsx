import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { LoginPage } from '../pages/LoginPage';
import { MyInvoicesPage } from '../pages/MyInvoicesPage';
import { MyProgressPage } from '../pages/MyProgressPage';
import { Layout } from './Layout';

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
        element={status === 'authenticated' ? <Navigate to="/progress" replace /> : <LoginPage />}
      />
      <Route
        path="/progress"
        element={
          <RequireAuth>
            <MyProgressPage />
          </RequireAuth>
        }
      />
      <Route
        path="/invoices"
        element={
          <RequireAuth>
            <MyInvoicesPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/progress" replace />} />
    </Routes>
  );
}
