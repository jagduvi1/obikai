import { confirmPasswordReset } from '@obikai/api-client';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

/**
 * Complete a password reset (E1). The token arrives in the link's `?token=` query (emailed by the
 * API). We validate length + match client-side for fast feedback, then POST; a bad/expired token
 * surfaces a generic error (the server reveals nothing more). On success we point the user to sign in.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const pwId = useId();
  const confirmId = useId();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError(t('auth.tooShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('auth.mismatch'));
      return;
    }
    setBusy(true);
    try {
      await confirmPasswordReset(token, password);
      setDone(true);
    } catch {
      setError(t('auth.resetError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className="auth-shell" tabIndex={-1}>
      <div className="auth-card">
        <h1>{t('auth.resetTitle')}</h1>
        {done ? (
          <>
            <output>{t('auth.resetDone')}</output>
            <p>
              <Link to="/login">{t('auth.backToLogin')}</Link>
            </p>
          </>
        ) : token === '' ? (
          <p role="alert" className="form-error">
            {t('auth.missingToken')}
          </p>
        ) : (
          <form onSubmit={onSubmit} aria-describedby={error ? 'reset-error' : undefined}>
            {error && (
              <p id="reset-error" role="alert" className="form-error">
                {error}
              </p>
            )}
            <label htmlFor={pwId}>{t('auth.newPassword')}</label>
            <input
              id={pwId}
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <label htmlFor={confirmId}>{t('auth.confirmPassword')}</label>
            <input
              id={confirmId}
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <button type="submit" disabled={busy}>
              {t('auth.setPassword')}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
