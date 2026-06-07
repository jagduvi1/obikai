import { login as apiLogin, logout as apiLogout, refresh, setOnAuthLost } from '@obikai/api-client';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

/**
 * Auth state for the platform console (ADR-0016/0024). The access token lives in the api client's
 * memory; the JWT is tenant-independent, so the same login flow works without a tenant. Whether the
 * signed-in user actually has PLATFORM access is enforced server-side by PlatformMiddleware (a 403
 * surfaces as a failed request, handled per-page). On mount we attempt a silent refresh.
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
