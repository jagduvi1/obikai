import { BrandLockup, SourceFooter } from '@obikai/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { SubjectSwitcher } from '../components/SubjectSwitcher';

/**
 * Member app shell — phone-first: a slim brand header, a scrollable main
 * landmark, and a bottom tab bar (text-only tabs, ≥44px targets; the product
 * ships no icon set). Skip link + labelled landmarks keep it WCAG 2.1 AA.
 */
export function Layout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { logout } = useAuth();
  return (
    <div className="member-shell">
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>
      <header className="member-header">
        <BrandLockup markSize={22} wordmarkSize="var(--text-base)" />
        <div className="member-header__actions">
          <SubjectSwitcher />
          <LanguageSwitcher />
          <button type="button" className="link-button" onClick={() => void logout()}>
            {t('app.signOut')}
          </button>
        </div>
      </header>
      <main id="main" className="member-main" tabIndex={-1}>
        {children}
        <SourceFooter style={{ marginTop: 'var(--space-5)' }} />
      </main>
      <nav aria-label={t('app.title')} className="member-tabs">
        <NavLink to="/progress">{t('nav.progress')}</NavLink>
        <NavLink to="/schedule">{t('nav.schedule')}</NavLink>
        <NavLink to="/attendance">{t('nav.attendance')}</NavLink>
        <NavLink to="/invoices">{t('nav.invoices')}</NavLink>
        <NavLink to="/waivers">{t('nav.waivers')}</NavLink>
        <NavLink to="/profile">{t('nav.profile')}</NavLink>
      </nav>
    </div>
  );
}
