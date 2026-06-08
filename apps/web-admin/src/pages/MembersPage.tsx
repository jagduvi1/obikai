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
  const [tagInput, setTagInput] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['members', { tag: tagFilter }],
    queryFn: () => listMembers(tagFilter ? { tag: tagFilter } : {}),
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

      <form
        className="filter-row"
        onSubmit={(e) => {
          e.preventDefault();
          setTagFilter(tagInput.trim());
        }}
      >
        <span className="field">
          <label htmlFor="member-tag-filter">{t('members.filterByTag')}</label>
          <input
            id="member-tag-filter"
            value={tagInput}
            placeholder={t('members.filterByTagPlaceholder')}
            onChange={(e) => setTagInput(e.target.value)}
          />
        </span>
        <button type="submit">{t('members.filterByTag')}</button>
        {tagFilter && (
          <button
            type="button"
            onClick={() => {
              setTagInput('');
              setTagFilter('');
            }}
          >
            {t('members.clearFilter')}
          </button>
        )}
      </form>

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
              <th scope="col">{t('members.tags')}</th>
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
                <td>{m.tags.length > 0 ? m.tags.join(', ') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
