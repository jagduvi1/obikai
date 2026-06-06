import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { login as apiLogin, logout as apiLogout, refresh, setOnAuthLost } from '../api/client';

/**
 * Auth state for the admin (ADR-0016). The access token lives in the api client's memory; this
 * context exposes the boolean "are we signed in" and the login/logout actions. On mount it attempts
 * a silent refresh (httpOnly cookie) so a page reload doesn't force re-login. `onAuthLost` from the
 * client flips us to signed-out if a refresh ever fails mid-session.
 */
interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');

  useEffect(() => {
    let active = true;
    setOnAuthLost(() => {
      if (active) setStatus('anonymous');
    });
    // Silent re-auth on load via the refresh cookie.
    refresh()
      .then((ok) => active && setStatus(ok ? 'authenticated' : 'anonymous'))
      .catch(() => active && setStatus('anonymous'));
    return () => {
      active = false;
      setOnAuthLost(null);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await apiLogin(email, password);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthState>(() => ({ status, login, logout }), [status, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
