import type { EligibilityResult, EligibilityStatus } from '@obikai/domain';
import { useTranslation } from 'react-i18next';

/** Read-only eligibility for the member's own view (no award action — members never self-promote). */
export function MyEligibility({ result }: { result: EligibilityResult }) {
  const { t } = useTranslation();
  if (result.nextSteps.length === 0) {
    return <p className="muted">{t('progress.topOfLadder')}</p>;
  }
  return (
    <ul className="step-list">
      {result.nextSteps.map((step) => (
        <li key={step.stepId} className="step-card">
          <div className="step-head">
            <strong>
              {t('progress.nextStep')}: {step.stepId}
            </strong>
            <StatusBadge status={step.status} />
          </div>
          <ul className="criteria">
            {step.criteria.map((c) => (
              <li key={c.type} data-satisfied={c.satisfied}>
                <span aria-hidden="true">{c.satisfied ? '✓' : '○'}</span> <span>{c.type}</span>
                {c.progress.unit !== 'boolean' && (
                  <>
                    {' '}
                    <progress
                      max={c.progress.target}
                      value={c.progress.current}
                      aria-label={`${c.type}: ${c.progress.current} / ${c.progress.target} ${c.progress.unit}`}
                    />{' '}
                    <span className="muted">
                      {c.progress.current}/{c.progress.target} {c.progress.unit}
                    </span>
                  </>
                )}
                {c.enforcement === 'advisory' && (
                  <span className="muted"> ({t('progress.advisory')})</span>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function StatusBadge({ status }: { status: EligibilityStatus }) {
  const { t } = useTranslation();
  return <span className={`badge badge-${status}`}>{t(`progress.status.${status}`)}</span>;
}
