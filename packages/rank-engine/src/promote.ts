import type { StepId } from '@obikai/domain';
import { evaluateStep } from './evaluate.js';
import type {
  EvaluationContext,
  ProgressionSystemVersion,
  PromoteOutcome,
  PromotionLogEntry,
  StudentProgressionInput,
} from './types.js';

export interface AwardRequest {
  readonly toStepId: StepId;
  readonly byRole: 'instructor' | 'owner';
  readonly userId: string;
  /** Human-entered reason to force-promote past an unmet required criterion. NEVER AI-populated
   * (ADR-0005). The engine records it but never originates it. */
  readonly overrideReason?: string;
}

/**
 * Pure. Produces a PROPOSED immutable promotion log entry referencing the exact version granted
 * under; the app persists it, advances enrollment, and fires certificate/notification side
 * effects. Refuses (ok:false) when a required criterion is unmet unless a human overrideReason is
 * supplied. The engine never persists and never auto-promotes.
 */
export function promote(
  version: ProgressionSystemVersion,
  input: StudentProgressionInput,
  award: AwardRequest,
  ctx: EvaluationContext,
): PromoteOutcome {
  const target = version.ladder.find((s) => s.id === award.toStepId);
  if (!target) return { ok: false, reason: 'unknownStep', unmet: [] };

  const elig = evaluateStep(version, target, input, ctx);
  if (elig.unmetRequired.length > 0 && award.overrideReason === undefined) {
    return { ok: false, reason: 'requiredCriteriaUnmet', unmet: elig.unmetRequired };
  }

  const entry: PromotionLogEntry = {
    systemId: version.systemId,
    systemVersionId: version.versionId,
    fromStepId: input.currentStepId,
    toStepId: award.toStepId,
    awardedAt: ctx.now,
    awardedByRole: award.byRole,
    awardingUserId: award.userId,
    satisfiedSnapshot: elig.criteria,
    ...(award.overrideReason !== undefined ? { overrideReason: award.overrideReason } : {}),
  };
  return { ok: true, entry };
}
