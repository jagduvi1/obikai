import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createDiscipline, listDisciplines } from '../api/rank';

/** Manage the arts the dojo teaches. Owner creates; the list drives rank enrollment elsewhere. */
export function DisciplinesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState('');

  const disciplines = useQuery({ queryKey: ['disciplines'], queryFn: () => listDisciplines() });
  const create = useMutation({
    mutationFn: (input: { name: string }) =>
      createDiscipline({ name: input.name, presentation: 'belt', active: true }),
    onSuccess: () => {
      setName('');
      void qc.invalidateQueries({ queryKey: ['disciplines'] });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) create.mutate({ name: name.trim() });
  }

  return (
    <section aria-labelledby="disc-heading">
      <h1 id="disc-heading">{t('disciplines.title')}</h1>

      <form className="inline-form" onSubmit={onSubmit}>
        <label htmlFor="disc-name">{t('disciplines.name')}</label>
        <input id="disc-name" value={name} onChange={(e) => setName(e.target.value)} required />
        <button type="submit" disabled={create.isPending || name.trim().length === 0}>
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
                <td>{d.name}</td>
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
