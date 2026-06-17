import type { StepId } from '@obikai/domain';
import { Decimal } from 'decimal.js';
import { ageYears, timeThresholdReached } from './time.js';
import type {
  CriterionEvaluation,
  CriterionLeaf,
  CriterionLeafType,
  EligibilityResult,
  EligibilityStatus,
  EvaluationContext,
  ProgressUnit,
  ProgressionSystemVersion,
  PromotionCriterion,
  Step,
  StepEligibility,
  StudentProgressionInput,
} from './types.js';

/** Clamp current/target into 0..1 using exact decimal math (no float drift). */
function fraction(current: number, target: number): number {
  if (target <= 0) return 1;
  const f = new Decimal(current).div(target);
  if (f.lt(0)) return 0;
  if (f.gt(1)) return 1;
  return f.toNumber();
}

const dedupe = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

interface EvalEnv {
  readonly input: StudentProgressionInput;
  readonly ctx: EvaluationContext;
  readonly stepIndex: ReadonlyMap<StepId, Step>;
  readonly targetStepId: StepId;
}

function reason(type: CriterionLeafType, satisfied: boolean): string {
  return `criteria.${type}.${satisfied ? 'met' : 'unmet'}`;
}

function numericEval(
  type: CriterionLeafType,
  enforcement: CriterionLeaf['enforcement'],
  current: number,
  target: number,
  unit: ProgressUnit,
): CriterionEvaluation {
  const satisfied = current >= target;
  return {
    type,
    enforcement,
    satisfied,
    progress: {
      current,
      target,
      remaining: Math.max(0, target - current),
      unit,
      fractionComplete: fraction(current, target),
    },
    reasonKey: reason(type, satisfied),
  };
}

function booleanEval(
  type: CriterionLeafType,
  enforcement: CriterionLeaf['enforcement'],
  met: boolean,
): CriterionEvaluation {
  return {
    type,
    enforcement,
    satisfied: met,
    progress: {
      current: met ? 1 : 0,
      target: 1,
      remaining: met ? 0 : 1,
      unit: 'boolean',
      fractionComplete: met ? 1 : 0,
    },
    reasonKey: reason(type, met),
  };
}

function evaluateLeaf(leaf: CriterionLeaf, env: EvalEnv): CriterionEvaluation {
  switch (leaf.type) {
    case 'minTimeAtStep': {
      const { met, currentDays, targetDays } = timeThresholdReached(
        env.input.enteredCurrentStepAt,
        env.ctx.now,
        env.ctx.zone,
        leaf.months ?? 0,
        leaf.days ?? 0,
      );
      return {
        type: 'minTimeAtStep',
        enforcement: leaf.enforcement,
        satisfied: met,
        progress: {
          current: currentDays,
          target: targetDays,
          remaining: Math.max(0, targetDays - currentDays),
          unit: 'days',
          fractionComplete: fraction(currentDays, targetDays),
        },
        reasonKey: reason('minTimeAtStep', met),
      };
    }
    case 'minClassesSinceLastPromotion':
      return numericEval(
        'minClassesSinceLastPromotion',
        leaf.enforcement,
        env.input.attendanceSinceLastPromotion,
        leaf.count,
        'classes',
      );
    case 'minTotalClasses':
      return numericEval(
        'minTotalClasses',
        leaf.enforcement,
        env.input.totalAttendance,
        leaf.count,
        'classes',
      );
    case 'minAge': {
      const current = env.input.dateOfBirth
        ? ageYears(env.input.dateOfBirth, env.ctx.now, env.ctx.zone)
        : 0;
      return numericEval('minAge', leaf.enforcement, current, leaf.years, 'years');
    }
    case 'prerequisiteStep': {
      const pre = env.stepIndex.get(leaf.stepId);
      const current = env.input.currentStepId
        ? env.stepIndex.get(env.input.currentStepId)
        : undefined;
      let met = false;
      if (pre && current && current.trackId === pre.trackId) met = current.order >= pre.order;
      else if (env.input.currentStepId === leaf.stepId) met = true;
      return booleanEval('prerequisiteStep', leaf.enforcement, met);
    }
    case 'requiredCurriculumItems': {
      const completed = new Set(env.input.completedCurriculumItemIds);
      const done = leaf.itemIds.filter((i) => completed.has(i)).length;
      return numericEval(
        'requiredCurriculumItems',
        leaf.enforcement,
        done,
        leaf.itemIds.length,
        'items',
      );
    }
    case 'passedGradingEvent': {
      const met = env.input.gradingResults.some((g) => g.passed && g.stepId === env.targetStepId);
      return booleanEval('passedGradingEvent', leaf.enforcement, met);
    }
    case 'manualInstructorSignOff': {
      const met = env.input.manualSignOffs.some(
        (s) => s.stepId === env.targetStepId && (leaf.role === undefined || s.byRole === leaf.role),
      );
      return booleanEval('manualInstructorSignOff', leaf.enforcement, met);
    }
  }
}

interface NodeEval {
  readonly satisfied: boolean;
  /**
   * The ACTUAL unmet-required leaf evaluations gating this node (not just their types). anyOf-aware: a
   * satisfied branch contributes none. Carried as evaluations (not a type list) so the close/notYet
   * bucket is computed over the real blockers — never re-selected by criterion TYPE, which could pull
   * in an unmet leaf from a *satisfied* anyOf branch that happens to share a type with a real blocker.
   */
  readonly blockingRequired: readonly CriterionEvaluation[];
  readonly evaluations: readonly CriterionEvaluation[];
}

function evaluateNode(node: PromotionCriterion, env: EvalEnv): NodeEval {
  if (node.type === 'allOf') {
    const parts = node.criteria.map((c) => evaluateNode(c, env));
    return {
      satisfied: parts.every((p) => p.satisfied),
      blockingRequired: parts.flatMap((p) => p.blockingRequired),
      evaluations: parts.flatMap((p) => p.evaluations),
    };
  }
  if (node.type === 'anyOf') {
    const parts = node.criteria.map((c) => evaluateNode(c, env));
    const satisfied = parts.some((p) => p.satisfied);
    return {
      satisfied,
      blockingRequired: satisfied ? [] : parts.flatMap((p) => p.blockingRequired),
      evaluations: parts.flatMap((p) => p.evaluations),
    };
  }
  const ev = evaluateLeaf(node, env);
  return {
    satisfied: ev.satisfied,
    blockingRequired: ev.enforcement === 'required' && !ev.satisfied ? [ev] : [],
    evaluations: [ev],
  };
}

function evaluateStep(
  version: ProgressionSystemVersion,
  step: Step,
  input: StudentProgressionInput,
  ctx: EvaluationContext,
): StepEligibility {
  const stepIndex = new Map(version.ladder.map((s) => [s.id, s] as const));
  const node = evaluateNode(step.criteria, { input, ctx, stepIndex, targetStepId: step.id });
  // The actual unmet-required leaf evaluations gating this step (anyOf-aware — a satisfied branch
  // clears the other branch's required leaves). The displayed type list derives from these.
  const blocking = node.blockingRequired;
  const unmetRequired = dedupe(blocking.map((e) => e.type));
  const unmetAdvisory = dedupe(
    node.evaluations.filter((e) => e.enforcement === 'advisory' && !e.satisfied).map((e) => e.type),
  );
  let status: EligibilityStatus;
  if (unmetRequired.length === 0) {
    status = 'ready'; // all required met — advisory criteria never block readiness
  } else {
    // close/notYet from the REAL blockers' progress (never a satisfied anyOf branch's stale leaf).
    const minFraction = Math.min(...blocking.map((e) => e.progress.fractionComplete));
    status = minFraction >= 0.5 ? 'close' : 'notYet';
  }
  // Canonical ordering so the snapshot is a pure function of content, not input order. Code-point
  // comparison (NOT localeCompare) keeps it locale-independent — the engine forbids ambient locale
  // (ADR-0005); the type keys are ASCII identifiers so code-point order is stable across hosts.
  const criteria = [...node.evaluations].sort((a, b) =>
    a.type < b.type ? -1 : a.type > b.type ? 1 : 0,
  );
  return { stepId: step.id, status, criteria, unmetRequired, unmetAdvisory };
}

function stepsInTrack(version: ProgressionSystemVersion, trackId: string): Step[] {
  return version.ladder
    .filter((s) => s.trackId === trackId)
    .slice()
    .sort((a, b) => a.order - b.order);
}

function nextStepFor(trackSteps: readonly Step[], currentStepId: StepId | null): Step | null {
  if (currentStepId === null) return trackSteps[0] ?? null;
  const idx = trackSteps.findIndex((s) => s.id === currentStepId);
  if (idx === -1) return null;
  return trackSteps[idx + 1] ?? null;
}

/** Pure, deterministic. Given a student's snapshot, compute the immediate next step's eligibility
 * with per-criterion "how close". */
export function evaluateEligibility(
  version: ProgressionSystemVersion,
  input: StudentProgressionInput,
  ctx: EvaluationContext,
): EligibilityResult {
  const trackSteps = stepsInTrack(version, input.trackId);
  const next = nextStepFor(trackSteps, input.currentStepId);
  const nextSteps = next ? [evaluateStep(version, next, input, ctx)] : [];
  return { systemVersionId: version.versionId, evaluatedAt: ctx.now, nextSteps };
}

export { evaluateStep };
