import {
  DEFAULT_LOCALE,
  type Locale,
  type LocalizedString,
  resolveLocalized,
} from '@obikai/domain';
import { UI_LOCALES, UI_LOCALE_NATIVE_NAMES } from '@obikai/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createDiscipline, listDisciplines } from '../api/rank';

const emptyNames = (): Partial<Record<Locale, string>> => ({});

/** Manage the arts the dojo teaches. Names are translatable (i18n H4, ADR-0029): authored per locale,
 *  shown resolved to the viewer's language. The list drives rank enrollment elsewhere. */
export function DisciplinesPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [names, setNames] = useState<Partial<Record<Locale, string>>>(emptyNames);

  const viewer: Locale = (i18n.resolvedLanguage ?? i18n.language) as Locale;
  const show = (value: LocalizedString): string =>
    resolveLocalized(value, { requested: viewer, defaultLocale: DEFAULT_LOCALE }) ?? '';

  const disciplines = useQuery({ queryKey: ['disciplines'], queryFn: () => listDisciplines() });
  const create = useMutation({
    mutationFn: (name: LocalizedString) =>
      createDiscipline({ name, presentation: 'belt', active: true }),
    onSuccess: () => {
      setNames(emptyNames());
      void qc.invalidateQueries({ queryKey: ['disciplines'] });
    },
  });

  // Collect the non-empty per-locale inputs into a LocalizedString (≥1 required by the API).
  const filledName: LocalizedString = Object.fromEntries(
    UI_LOCALES.map((l) => [l, names[l]?.trim()]).filter(([, v]) => v),
  );
  const hasName = Object.keys(filledName).length > 0;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (hasName) create.mutate(filledName);
  }

  return (
    <section aria-labelledby="disc-heading">
      <h1 id="disc-heading">{t('disciplines.title')}</h1>

      <form className="stacked-form" onSubmit={onSubmit}>
        <fieldset>
          <legend>{t('disciplines.name')}</legend>
          {UI_LOCALES.map((locale) => (
            <label key={locale} className="field">
              <span className="field-label">{UI_LOCALE_NATIVE_NAMES[locale]}</span>
              <input
                value={names[locale] ?? ''}
                onChange={(ev) => setNames((prev) => ({ ...prev, [locale]: ev.target.value }))}
                lang={locale}
              />
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={create.isPending || !hasName}>
          {t('disciplines.create')}
        </button>
      </form>
      {create.isError && <p className="form-error">{t('disciplines.createError')}</p>}

      {disciplines.isLoading && <p>{t('disciplines.loading')}</p>}
      {disciplines.data && disciplines.data.length === 0 && (
        <p className="muted">{t('disciplines.empty')}</p>
      )}
      {disciplines.data && disciplines.data.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('disciplines.name')}</th>
              <th scope="col">{t('disciplines.presentation')}</th>
              <th scope="col">{t('disciplines.active')}</th>
            </tr>
          </thead>
          <tbody>
            {disciplines.data.map((d) => (
              <tr key={d.id}>
                <td>{show(d.name)}</td>
                <td>{d.presentation}</td>
                <td>{d.active ? t('common.yes') : t('common.no')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
