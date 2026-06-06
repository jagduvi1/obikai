import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { formatMoney, listMemberInvoices } from '../api/billing';
import { getMember } from '../api/members';
import { enrollInDiscipline, listDisciplines, listRankStates } from '../api/rank';
import { DisciplineRankSection } from '../components/DisciplineRankSection';

/** Member detail: profile + per-discipline rank panel (eligibility/award/history) + enrollment. */
export function MemberDetailPage() {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [toEnroll, setToEnroll] = useState('');

  const member = useQuery({
    queryKey: ['member', id],
    queryFn: () => getMember(id),
    enabled: !!id,
  });
  const rankStates = useQuery({
    queryKey: ['rankStates', id],
    queryFn: () => listRankStates(id),
    enabled: !!id,
  });
  const disciplines = useQuery({
    queryKey: ['disciplines', 'active'],
    queryFn: () => listDisciplines({ active: true }),
  });
  const invoices = useQuery({
    queryKey: ['memberInvoices', id],
    queryFn: () => listMemberInvoices(id),
    enabled: !!id,
  });

  const enroll = useMutation({
    mutationFn: (disciplineId: string) => enrollInDiscipline(id, disciplineId),
    onSuccess: () => {
      setToEnroll('');
      void qc.invalidateQueries({ queryKey: ['rankStates', id] });
    },
  });

  const nameOf = (disciplineId: string) =>
    disciplines.data?.find((d) => d.id === disciplineId)?.name ?? disciplineId;
  const enrolledIds = new Set((rankStates.data ?? []).map((s) => s.disciplineId));
  const enrollable = (disciplines.data ?? []).filter((d) => !enrolledIds.has(d.id));

  return (
    <div>
      <p>
        <Link to="/members">← {t('members.title')}</Link>
      </p>
      {member.isLoading && <p>{t('members.loading')}</p>}
      {member.isError && <p className="form-error">{t('members.error')}</p>}
      {member.data && (
        <h1>
          {member.data.firstName} {member.data.lastName}
        </h1>
      )}

      <section aria-labelledby="rank-heading">
        <h2 id="rank-heading">{t('rank.title')}</h2>

        <form
          className="enroll-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (toEnroll) enroll.mutate(toEnroll);
          }}
        >
          <label htmlFor="enroll-select">{t('rank.enrollIn')}</label>
          <select id="enroll-select" value={toEnroll} onChange={(e) => setToEnroll(e.target.value)}>
            <option value="">{t('rank.selectDiscipline')}</option>
            {enrollable.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button type="submit" disabled={!toEnroll || enroll.isPending}>
            {t('rank.enroll')}
          </button>
        </form>

        {rankStates.data && rankStates.data.length === 0 && (
          <p className="muted">{t('rank.notEnrolled')}</p>
        )}
        {rankStates.data?.map((s) => (
          <DisciplineRankSection
            key={s.id}
            memberId={id}
            disciplineId={s.disciplineId}
            disciplineName={nameOf(s.disciplineId)}
          />
        ))}
      </section>

      <section aria-labelledby="inv-heading">
        <h2 id="inv-heading">{t('memberInvoices.title')}</h2>
        {invoices.isLoading && <p>{t('memberInvoices.loading')}</p>}
        {invoices.isError && <p className="form-error">{t('memberInvoices.error')}</p>}
        {invoices.data && invoices.data.length === 0 && (
          <p className="muted">{t('memberInvoices.empty')}</p>
        )}
        {invoices.data && invoices.data.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('memberInvoices.number')}</th>
                <th scope="col">{t('memberInvoices.status')}</th>
                <th scope="col">{t('memberInvoices.total')}</th>
                <th scope="col">{t('memberInvoices.issued')}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.data.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.number ?? '—'}</td>
                  <td>{inv.status}</td>
                  <td>{formatMoney(inv.total, i18n.language)}</td>
                  <td>
                    {inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString(i18n.language) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
