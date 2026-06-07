import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/auth-context';

/** Accessible platform sign-in: labelled inputs, an aria-live error region, a busy state. */
export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(false);
    setBusy(true);
    try {
      await login(email, password);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className="auth-shell" tabIndex={-1}>
      <form
        className="auth-card"
        onSubmit={onSubmit}
        aria-describedby={error ? 'login-error' : undefined}
      >
        <h1>{t('login.title')}</h1>
        {error && (
          <p id="login-error" role="alert" className="form-error">
            {t('login.error')}
          </p>
        )}
        <label htmlFor={emailId}>{t('login.email')}</label>
        <input
          id={emailId}
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor={passwordId}>{t('login.password')}</label>
        <input
          id={passwordId}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          {t('login.submit')}
        </button>
      </form>
    </main>
  );
}
