import { requestPasswordReset } from '@obikai/api-client';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

/**
 * Request a password-reset email (E1). The API always returns 204 (no account enumeration), so on
 * success we show the same neutral "check your inbox" message whether or not the email is registered.
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const emailId = useId();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await requestPasswordReset(email);
    } catch {
      // Swallow: never reveal whether the email exists, and never surface a transient failure
      // differently from success (no enumeration). The user can simply try again.
    } finally {
      setBusy(false);
      setSent(true);
    }
  }

  return (
    <main id="main" className="auth-shell" tabIndex={-1}>
      <div className="auth-card">
        <h1>{t('auth.forgotTitle')}</h1>
        {sent ? (
          <output>{t('auth.resetSent')}</output>
        ) : (
          <form onSubmit={onSubmit}>
            <p>{t('auth.forgotIntro')}</p>
            <label htmlFor={emailId}>{t('auth.emailLabel')}</label>
            <input
              id={emailId}
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" disabled={busy}>
              {t('auth.sendResetLink')}
            </button>
          </form>
        )}
        <p>
          <Link to="/login">{t('auth.backToLogin')}</Link>
        </p>
      </div>
    </main>
  );
}
