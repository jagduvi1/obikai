import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { DisciplinesPage } from '../pages/DisciplinesPage';
import { LoginPage } from '../pages/LoginPage';
import { MemberDetailPage } from '../pages/MemberDetailPage';
import { MembersPage } from '../pages/MembersPage';
import { PlansPage } from '../pages/PlansPage';
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
        element={status === 'authenticated' ? <Navigate to="/members" replace /> : <LoginPage />}
      />
      <Route
        path="/members"
        element={
          <RequireAuth>
            <MembersPage />
          </RequireAuth>
        }
      />
      <Route
        path="/members/:id"
        element={
          <RequireAuth>
            <MemberDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/disciplines"
        element={
          <RequireAuth>
            <DisciplinesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/plans"
        element={
          <RequireAuth>
            <PlansPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/members" replace />} />
    </Routes>
  );
}
