import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { ClassesPage } from '../pages/ClassesPage';
import { DisciplinesPage } from '../pages/DisciplinesPage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { LocationsPage } from '../pages/LocationsPage';
import { LoginPage } from '../pages/LoginPage';
import { MemberDetailPage } from '../pages/MemberDetailPage';
import { MembersPage } from '../pages/MembersPage';
import { MessagesPage } from '../pages/MessagesPage';
import { OccurrenceDetailPage } from '../pages/OccurrenceDetailPage';
import { OccurrencesPage } from '../pages/OccurrencesPage';
import { PlansPage } from '../pages/PlansPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { SettingsPage } from '../pages/SettingsPage';
import { VerifyEmailPage } from '../pages/VerifyEmailPage';
import { WaiversPage } from '../pages/WaiversPage';
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
      {/* Public, unauthenticated account-recovery routes (reached from emailed links). */}
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
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
      <Route
        path="/waivers"
        element={
          <RequireAuth>
            <WaiversPage />
          </RequireAuth>
        }
      />
      <Route
        path="/messages"
        element={
          <RequireAuth>
            <MessagesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/classes"
        element={
          <RequireAuth>
            <ClassesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/locations"
        element={
          <RequireAuth>
            <LocationsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/occurrences"
        element={
          <RequireAuth>
            <OccurrencesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/occurrences/:id"
        element={
          <RequireAuth>
            <OccurrenceDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/members" replace />} />
    </Routes>
  );
}
