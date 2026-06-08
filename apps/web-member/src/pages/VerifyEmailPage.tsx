import { confirmEmailVerification } from '@obikai/api-client';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

/**
 * Confirm an email address (E2). The token arrives in the link's `?token=` query (emailed by the
 * API); we submit it once on mount. A ref guards against React StrictMode's double-invoke — the token
 * is single-use, so a second POST would fail after the first succeeded.
 */
export function VerifyEmailPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'verifying' | 'done' | 'error'>('verifying');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (token === '') {
      setState('error');
      return;
    }
    confirmEmailVerification(token)
      .then(() => setState('done'))
      .catch(() => setState('error'));
  }, [token]);

  return (
    <main id="main" className="auth-shell" tabIndex={-1}>
      <div className="auth-card">
        <h1>{t('auth.verifyTitle')}</h1>
        {state === 'verifying' && <output>{t('auth.verifying')}</output>}
        {state === 'done' && <output>{t('auth.verifyDone')}</output>}
        {state === 'error' && (
          <p role="alert" className="form-error">
            {t('auth.verifyError')}
          </p>
        )}
        <p>
          <Link to="/login">{t('auth.backToLogin')}</Link>
        </p>
      </div>
    </main>
  );
}
