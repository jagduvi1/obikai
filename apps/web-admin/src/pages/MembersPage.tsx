import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { createMember, listMembers } from '../api/members';
import { MemberForm } from '../components/MemberForm';

/** Members list + create form — proves the full stack: auth'd fetch → typed @obikai/domain data → a11y. */
export function MembersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['members'],
    queryFn: () => listMembers(),
  });

  const create = useMutation({
    mutationFn: createMember,
    onSuccess: () => {
      setAdding(false);
      void qc.invalidateQueries({ queryKey: ['members'] });
    },
  });

  return (
    <section aria-labelledby="members-heading">
      <h1 id="members-heading">{t('members.title')}</h1>

      {adding ? (
        <MemberForm
          submitLabel={t('memberForm.create')}
          pending={create.isPending}
          error={create.isError}
          onSubmit={(input) => create.mutate(input)}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)}>
          {t('memberForm.add')}
        </button>
      )}
      <output className="status">{create.isSuccess ? t('memberForm.created') : ''}</output>

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
                  <Link to={`/members/${m.id}`}>
                    {m.firstName} {m.lastName}
                  </Link>
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
