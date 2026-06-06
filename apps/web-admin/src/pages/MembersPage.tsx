import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listMembers } from '../api/members';

/** Members list — proves the full stack: auth'd fetch → typed @obikai/domain data → a11y table. */
export function MembersPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['members'],
    queryFn: () => listMembers(),
  });

  return (
    <section aria-labelledby="members-heading">
      <h1 id="members-heading">{t('members.title')}</h1>
      {isLoading && <p>{t('members.loading')}</p>}
      {isError && (
        <p role="alert" className="form-error">
          {t('members.error')}
        </p>
      )}
      {data && data.length === 0 && <p>{t('members.empty')}</p>}
      {data && data.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('members.name')}</th>
              <th scope="col">{t('members.email')}</th>
              <th scope="col">{t('members.status')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.firstName} {m.lastName}
                </td>
                <td>{m.email ?? '—'}</td>
                <td>{m.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
