import { changePassword } from '@obikai/api-client';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Change-password form for the authenticated account (E3). Proves the current password; on success the
 * API revokes every session and issues a fresh one, which the api-client adopts — so the user stays
 * signed in on this device while any other device is logged out.
 */
export function ChangePasswordCard() {
  const { t } = useTranslation();
  const currentId = useId();
  const newId = useId();
  const confirmId = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next.length < 12) {
      setError(t('auth.tooShort'));
      return;
    }
    if (next !== confirm) {
      setError(t('auth.mismatch'));
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch {
      setError(t('auth.changeError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="change-password-heading">
      <h2 id="change-password-heading">{t('auth.changeTitle')}</h2>
      <form
        className="stacked-form"
        onSubmit={onSubmit}
        aria-describedby={error ? 'change-password-error' : undefined}
      >
        {error && (
          <p id="change-password-error" role="alert" className="form-error">
            {error}
          </p>
        )}
        <span className="field">
          <label htmlFor={currentId}>{t('auth.currentPassword')}</label>
          <input
            id={currentId}
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </span>
        <span className="field">
          <label htmlFor={newId}>{t('auth.newPassword')}</label>
          <input
            id={newId}
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </span>
        <span className="field">
          <label htmlFor={confirmId}>{t('auth.confirmPassword')}</label>
          <input
            id={confirmId}
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </span>
        <div>
          <button type="submit" disabled={busy}>
            {t('auth.changeSubmit')}
          </button>
        </div>
      </form>
      <output className="status">{done ? t('auth.changeDone') : ''}</output>
    </section>
  );
}
