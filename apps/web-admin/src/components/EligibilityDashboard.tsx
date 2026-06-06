import type { EligibilityResult, EligibilityStatus, StepEligibility } from '@obikai/domain';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Renders an engine EligibilityResult: each next step with a ready/close/notYet badge, per-criterion
 * progress (native <progress> for screen readers), and an award control. A step with unmet REQUIRED
 * criteria requires an explicit override reason before it can be force-promoted (invariant 4/5).
 */
export function EligibilityDashboard({
  result,
  onAward,
  pending,
}: {
  result: EligibilityResult;
  onAward: (stepId: string, overrideReason?: string) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  if (result.nextSteps.length === 0) {
    return <p className="muted">{t('rank.topOfLadder')}</p>;
  }
  return (
    <ul className="step-list">
      {result.nextSteps.map((step) => (
        <li key={step.stepId}>
          <StepCard step={step} onAward={onAward} pending={pending} />
        </li>
      ))}
    </ul>
  );
}

function StatusBadge({ status }: { status: EligibilityStatus }) {
  const { t } = useTranslation();
  return (
    <span className={`badge badge-${status}`} data-status={status}>
      {t(`rank.status.${status}`)}
    </span>
  );
}

function StepCard({
  step,
  onAward,
  pending,
}: {
  step: StepEligibility;
  onAward: (stepId: string, overrideReason?: string) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [override, setOverride] = useState('');
  const needsOverride = step.unmetRequired.length > 0;

  return (
    <div className="step-card">
      <div className="step-head">
        <strong>{step.stepId}</strong>
        <StatusBadge status={step.status} />
      </div>
      <ul className="criteria">
        {step.criteria.map((c) => (
          <li key={c.type} data-satisfied={c.satisfied}>
            <span aria-hidden="true">{c.satisfied ? '✓' : '○'}</span>{' '}
            <span className="criterion-type">{c.type}</span>
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
            {c.enforcement === 'advisory' && <span className="muted"> ({t('rank.advisory')})</span>}
          </li>
        ))}
      </ul>
      {needsOverride ? (
        <div className="award-override">
          <label htmlFor={`ovr-${step.stepId}`}>{t('rank.overrideReason')}</label>
          <input
            id={`ovr-${step.stepId}`}
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            placeholder={t('rank.overridePlaceholder')}
          />
          <button
            type="button"
            disabled={pending || override.trim().length === 0}
            onClick={() => onAward(step.stepId, override.trim())}
          >
            {t('rank.forcePromote')}
          </button>
        </div>
      ) : (
        <button type="button" disabled={pending} onClick={() => onAward(step.stepId)}>
          {t('rank.award')}
        </button>
      )}
    </div>
  );
}
