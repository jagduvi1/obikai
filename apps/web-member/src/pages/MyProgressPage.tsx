import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getMe,
  myDisciplines,
  myEligibility,
  myPromotions,
  myRankStates,
} from '../api/member-data';
import { MyEligibility } from '../components/MyEligibility';

/** "My progress": the member's own rank eligibility per discipline + their promotion history. */
export function MyProgressPage() {
  const { t } = useTranslation();
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const memberId = me.data?.memberId ?? null;

  const rankStates = useQuery({
    queryKey: ['myRankStates', memberId],
    queryFn: () => myRankStates(memberId as string),
    enabled: !!memberId,
  });
  const disciplines = useQuery({ queryKey: ['disciplines'], queryFn: myDisciplines });
  const nameOf = (id: string) => disciplines.data?.find((d) => d.id === id)?.name ?? id;

  return (
    <section aria-labelledby="progress-heading">
      <h1 id="progress-heading">{t('progress.title')}</h1>
      {(me.isLoading || rankStates.isLoading) && <p>{t('progress.loading')}</p>}
      {me.isError && <p className="form-error">{t('progress.error')}</p>}
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
