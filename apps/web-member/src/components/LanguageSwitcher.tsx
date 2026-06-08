import { UI_LOCALES, UI_LOCALE_NATIVE_NAMES } from '@obikai/i18n';
import { useTranslation } from 'react-i18next';

/**
 * Accessible language picker (H2). Options show each language's endonym; changing it calls
 * i18next.changeLanguage, which the i18n setup persists and reflects on `<html lang>`. A native
 * `<select>` keeps it keyboard- and screen-reader-friendly (WCAG 2.1 AA); the control is labelled
 * via aria-label so it needs no visible label chrome in the header.
 */
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const current = i18n.resolvedLanguage ?? i18n.language;
  const value = (UI_LOCALES as readonly string[]).includes(current) ? current : 'en';
  return (
    <select
      className="language-switcher"
      aria-label={t('app.language')}
      value={value}
      onChange={(event) => void i18n.changeLanguage(event.target.value)}
    >
      {UI_LOCALES.map((locale) => (
        <option key={locale} value={locale}>
          {UI_LOCALE_NATIVE_NAMES[locale]}
        </option>
      ))}
    </select>
  );
}
