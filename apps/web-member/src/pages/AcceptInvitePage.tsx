import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';

/**
 * Accept a member invite (onboarding). The token arrives in the link's `?token=` query (emailed by the
 * dojo). The member chooses a password; on success the API creates + links their account and signs them
 * in, so we navigate straight to their progress page. A bad/expired token surfaces a generic error.
 */
export function AcceptInvitePage() {
  const { t } = useTranslation();
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const pwId = useId();
  const confirmId = useId();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
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
      await acceptInvite(token, password);
      navigate('/progress', { replace: true });
    } catch {
      setError(t('auth.inviteError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className="auth-shell" tabIndex={-1}>
      <div className="auth-card">
        <h1>{t('auth.inviteTitle')}</h1>
        {token === '' ? (
          <p role="alert" className="form-error">
            {t('auth.missingToken')}
          </p>
        ) : (
          <form onSubmit={onSubmit} aria-describedby={error ? 'invite-error' : undefined}>
            {error && (
              <p id="invite-error" role="alert" className="form-error">
                {error}
              </p>
            )}
            <p>{t('auth.inviteIntro')}</p>
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
              {t('auth.acceptSubmit')}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
