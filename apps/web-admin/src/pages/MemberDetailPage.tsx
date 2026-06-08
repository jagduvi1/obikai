import { DEFAULT_LOCALE, type Locale, resolveLocalized } from '@obikai/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { downloadInvoicePdf, formatMoney, listMemberInvoices } from '../api/billing';
import { getMember, inviteMember, updateMember } from '../api/members';
import { enrollInDiscipline, listDisciplines, listRankStates } from '../api/rank';
import { DisciplineRankSection } from '../components/DisciplineRankSection';
import { MemberForm } from '../components/MemberForm';

/** Member detail: profile + per-discipline rank panel (eligibility/award/history) + enrollment. */
export function MemberDetailPage() {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [toEnroll, setToEnroll] = useState('');
  const [editing, setEditing] = useState(false);

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

  const update = useMutation({
    mutationFn: (input: Parameters<typeof updateMember>[1]) => updateMember(id, input),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ['member', id] });
      void qc.invalidateQueries({ queryKey: ['members'] });
    },
  });

  const invite = useMutation({ mutationFn: () => inviteMember(id) });

  // Discipline names are translatable (H4) — resolve to the viewer's locale.
  const viewer = (i18n.resolvedLanguage ?? i18n.language) as Locale;
  const nameOf = (disciplineId: string) => {
    const d = disciplines.data?.find((x) => x.id === disciplineId);
    return d
      ? (resolveLocalized(d.name, { requested: viewer, defaultLocale: DEFAULT_LOCALE }) ??
          disciplineId)
      : disciplineId;
  };
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
        <>
          <h1>
            {member.data.firstName} {member.data.lastName}
          </h1>
          <section aria-labelledby="profile-heading">
            <div className="section-head">
              <h2 id="profile-heading">{t('memberForm.editProfile')}</h2>
              {!editing && (
                <button type="button" onClick={() => setEditing(true)}>
                  {t('memberForm.editProfile')}
                </button>
              )}
            </div>
            <div className="invite-row">
              {member.data.userId ? (
                <span className="muted">{t('memberForm.hasAccount')}</span>
              ) : member.data.email ? (
                <button
                  type="button"
                  onClick={() => invite.mutate()}
                  disabled={invite.isPending || invite.isSuccess}
                >
                  {t('memberForm.invite')}
                </button>
              ) : (
                <span className="muted">{t('memberForm.inviteNoEmail')}</span>
              )}
              <output className="status">
                {invite.isSuccess ? t('memberForm.inviteSent') : ''}
              </output>
              {invite.isError && <span className="form-error">{t('memberForm.inviteError')}</span>}
            </div>
            {editing && (
              <MemberForm
                initial={{
                  firstName: member.data.firstName,
                  lastName: member.data.lastName,
                  email: member.data.email ?? '',
                  phone: member.data.phone ?? '',
                  dateOfBirth: member.data.dateOfBirth ?? '',
                  status: member.data.status,
                  notes: member.data.notes ?? '',
                  tags: member.data.tags.join(', '),
                }}
                submitLabel={t('memberForm.save')}
                pending={update.isPending}
                error={update.isError}
                onSubmit={(input) => update.mutate(input)}
              />
            )}
            <output className="status">{update.isSuccess ? t('memberForm.saved') : ''}</output>
          </section>
        </>
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
                {nameOf(d.id)}
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
                <th scope="col">{t('memberInvoices.actions')}</th>
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
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => void downloadInvoicePdf(inv.id, inv.number ?? inv.id)}
                    >
                      {t('memberInvoices.pdf')}
                    </button>
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
