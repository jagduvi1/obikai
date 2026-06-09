import { DEFAULT_LOCALE, type Locale, resolveLocalized } from '@obikai/domain';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { myDisciplines, myEligibility, myPromotions, myRankStates } from '../api/member-data';
import { MyEligibility } from '../components/MyEligibility';
import { useSubject } from '../subject/subject-context';

/** "My progress": the active subject's rank eligibility per discipline + their promotion history. */
export function MyProgressPage() {
  const { t, i18n } = useTranslation();
  const viewer = (i18n.resolvedLanguage ?? i18n.language) as Locale;
  const { activeMemberId: memberId, loading: subjectLoading, isError: subjectError } = useSubject();

  const rankStates = useQuery({
    queryKey: ['myRankStates', memberId],
    queryFn: () => myRankStates(memberId as string),
    enabled: !!memberId,
  });
  const disciplines = useQuery({ queryKey: ['disciplines'], queryFn: myDisciplines });
  // Discipline names are translatable (H4) — resolve to the viewer's locale, fall back to the id.
  const nameOf = (id: string) => {
    const d = disciplines.data?.find((x) => x.id === id);
    return d
      ? (resolveLocalized(d.name, { requested: viewer, defaultLocale: DEFAULT_LOCALE }) ?? id)
      : id;
  };

  return (
    <section aria-labelledby="progress-heading">
      <h1 id="progress-heading">{t('progress.title')}</h1>
      {(subjectLoading || rankStates.isLoading) && <p>{t('progress.loading')}</p>}
      {(subjectError || rankStates.isError) && <p className="form-error">{t('progress.error')}</p>}
      {memberId && rankStates.data && rankStates.data.length === 0 && (
        <p className="muted">{t('progress.notEnrolled')}</p>
      )}
      {memberId &&
        rankStates.data?.map((s) => (
          <DisciplineProgress
            key={s.id}
            memberId={memberId}
            disciplineId={s.disciplineId}
            disciplineName={nameOf(s.disciplineId)}
          />
        ))}
    </section>
  );
}

function DisciplineProgress({
  memberId,
  disciplineId,
  disciplineName,
}: {
  memberId: string;
  disciplineId: string;
  disciplineName: string;
}) {
  const { t } = useTranslation();
  const eligibility = useQuery({
    queryKey: ['myEligibility', memberId, disciplineId],
    queryFn: () => myEligibility(memberId, disciplineId),
  });
  const history = useQuery({
    queryKey: ['myPromotions', memberId, disciplineId],
    queryFn: () => myPromotions(memberId, disciplineId),
  });

  return (
    <section className="rank-section" aria-label={disciplineName}>
      <h2>{disciplineName}</h2>
      {eligibility.isLoading && <p>{t('progress.loading')}</p>}
      {eligibility.isError && <p className="form-error">{t('progress.error')}</p>}
      {eligibility.data && <MyEligibility result={eligibility.data} />}

      <h3>{t('progress.history')}</h3>
      {history.data && history.data.length === 0 && (
        <p className="muted">{t('progress.noHistory')}</p>
      )}
      {history.data && history.data.length > 0 && (
        <ol className="history">
          {history.data.map((p) => (
            <li key={p.id}>
              {p.fromStepId ?? '—'} → <strong>{p.toStepId}</strong>{' '}
              <span className="muted">{new Date(p.awardedAt).toLocaleDateString()}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
