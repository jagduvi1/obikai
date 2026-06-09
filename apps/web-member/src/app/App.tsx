import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { AcceptInvitePage } from '../pages/AcceptInvitePage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { LoginPage } from '../pages/LoginPage';
import { MyAttendancePage } from '../pages/MyAttendancePage';
import { MyInvoicesPage } from '../pages/MyInvoicesPage';
import { MyProgressPage } from '../pages/MyProgressPage';
import { MyWaiversPage } from '../pages/MyWaiversPage';
import { ProfilePage } from '../pages/ProfilePage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { SchedulePage } from '../pages/SchedulePage';
import { VerifyEmailPage } from '../pages/VerifyEmailPage';
import { SubjectProvider } from '../subject/subject-context';
import { Layout } from './Layout';

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <p className="centered">…</p>;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  // SubjectProvider lives inside the authenticated shell so it only loads /me + /me/dependents once
  // signed in; the chosen subject persists across the per-route remount via sessionStorage.
  return (
    <SubjectProvider>
      <Layout>{children}</Layout>
    </SubjectProvider>
  );
}

export function App() {
  const { status } = useAuth();
  return (
    <Routes>
      <Route
        path="/login"
        element={status === 'authenticated' ? <Navigate to="/progress" replace /> : <LoginPage />}
      />
      {/* Public, unauthenticated account routes (reached from emailed links). */}
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route
        path="/progress"
        element={
          <RequireAuth>
            <MyProgressPage />
          </RequireAuth>
        }
      />
      <Route
        path="/schedule"
        element={
          <RequireAuth>
            <SchedulePage />
          </RequireAuth>
        }
      />
      <Route
        path="/attendance"
        element={
          <RequireAuth>
            <MyAttendancePage />
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
      <Route
        path="/waivers"
        element={
          <RequireAuth>
            <MyWaiversPage />
          </RequireAuth>
        }
      />
      <Route
        path="/profile"
        element={
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/progress" replace />} />
    </Routes>
  );
}
