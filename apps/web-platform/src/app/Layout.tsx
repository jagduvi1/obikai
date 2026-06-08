import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

/** Platform console shell: skip link, labelled nav landmark, main region (WCAG 2.1 AA). */
export function Layout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { logout } = useAuth();
  return (
    <>
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>
      <header className="app-header">
        <span className="app-title">{t('app.title')}</span>
        <nav aria-label={t('nav.dashboard')} className="app-nav">
          <NavLink to="/tenants">{t('nav.tenants')}</NavLink>
          <NavLink to="/audit">{t('nav.audit')}</NavLink>
        </nav>
        <LanguageSwitcher />
        <button type="button" className="link-button" onClick={() => void logout()}>
          {t('app.signOut')}
        </button>
      </header>
      <main id="main" className="app-main" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
