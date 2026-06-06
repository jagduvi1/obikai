import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';

/**
 * App shell: a skip link, a labelled nav landmark, and the main content region (a11y / WCAG 2.1 AA,
 * invariant 6). The `#main` target + visible focus styles let keyboard users jump past the nav.
 */
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
          <NavLink to="/members">{t('nav.members')}</NavLink>
          <NavLink to="/disciplines">{t('nav.disciplines')}</NavLink>
          <NavLink to="/classes">{t('nav.classes')}</NavLink>
          <NavLink to="/locations">{t('nav.locations')}</NavLink>
          <NavLink to="/plans">{t('nav.plans')}</NavLink>
        </nav>
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
