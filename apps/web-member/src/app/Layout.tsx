import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

/** Member app shell: skip link, labelled nav, main landmark (WCAG 2.1 AA). */
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
        <nav aria-label={t('app.title')} className="app-nav">
          <NavLink to="/progress">{t('nav.progress')}</NavLink>
          <NavLink to="/invoices">{t('nav.invoices')}</NavLink>
          <NavLink to="/waivers">{t('nav.waivers')}</NavLink>
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
