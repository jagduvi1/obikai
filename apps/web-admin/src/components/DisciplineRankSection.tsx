import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { awardPromotion, getEligibility, listPromotions } from '../api/rank';
import { EligibilityDashboard } from './EligibilityDashboard';

/** One discipline's rank panel for a member: eligibility dashboard + award + promotion history. */
export function DisciplineRankSection({
  memberId,
  disciplineId,
  disciplineName,
}: {
  memberId: string;
  disciplineId: string;
  disciplineName: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const eligibility = useQuery({
    queryKey: ['eligibility', memberId, disciplineId],
    queryFn: () => getEligibility(memberId, disciplineId),
  });
  const history = useQuery({
    queryKey: ['promotions', memberId, disciplineId],
    queryFn: () => listPromotions(memberId, disciplineId),
  });

  const award = useMutation({
    mutationFn: (vars: { toStepId: string; overrideReason?: string }) =>
      awardPromotion({ memberId, disciplineId, ...vars }),
    onSuccess: (promo) => {
      setMessage({ kind: 'ok', text: t('rank.awarded', { step: promo.toStepId }) });
      void qc.invalidateQueries({ queryKey: ['eligibility', memberId, disciplineId] });
      void qc.invalidateQueries({ queryKey: ['promotions', memberId, disciplineId] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422) {
        const body = err.body as { unmet?: string[] } | undefined;
        setMessage({
          kind: 'err',
          text: t('rank.refused', { unmet: (body?.unmet ?? []).join(', ') }),
        });
      } else {
        setMessage({ kind: 'err', text: t('rank.awardError') });
      }
    },
  });

  return (
    <section className="rank-section" aria-label={disciplineName}>
      <h3>{disciplineName}</h3>
      {message && (
        <output className={message.kind === 'err' ? 'form-error' : 'form-ok'}>
          {message.text}
        </output>
      )}

      {eligibility.isLoading && <p>{t('rank.loading')}</p>}
      {eligibility.isError && <p className="form-error">{t('rank.error')}</p>}
      {eligibility.data && (
        <EligibilityDashboard
          result={eligibility.data}
          pending={award.isPending}
          onAward={(toStepId, overrideReason) =>
            award.mutate(overrideReason ? { toStepId, overrideReason } : { toStepId })
          }
        />
      )}

      <h4>{t('rank.history')}</h4>
      {history.data && history.data.length === 0 && <p className="muted">{t('rank.noHistory')}</p>}
      {history.data && history.data.length > 0 && (
        <ol className="history">
          {history.data.map((p) => (
            <li key={p.id}>
              {p.fromStepId ?? '—'} → <strong>{p.toStepId}</strong>{' '}
              <span className="muted">
                {new Date(p.awardedAt).toLocaleDateString()} · {p.awardedByRole}
                {p.overrideReason ? ` · ${t('rank.override')}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
