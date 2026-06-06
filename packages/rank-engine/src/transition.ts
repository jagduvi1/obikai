import type { StepId, TrackId } from '@obikai/domain';
import { ageYears } from './time.js';
import type {
  EvaluationContext,
  ProgressionSystemVersion,
  StudentProgressionInput,
} from './types.js';

export interface TransitionOutcome {
  readonly applies: boolean;
  readonly toTrackId?: TrackId;
  readonly toStepId?: StepId;
}

/**
 * Resolve the youth→adult crossing as an explicit, testable mapping (never inferred). Pure: uses
 * the injected clock + pinned zone for the age threshold.
 */
export function resolveTransition(
  version: ProgressionSystemVersion,
  input: StudentProgressionInput,
  ctx: EvaluationContext,
): TransitionOutcome {
  if (!input.dateOfBirth) return { applies: false };
  const age = ageYears(input.dateOfBirth, ctx.now, ctx.zone);

  // Pick the highest age threshold the student has reached, for this from-track.
  const candidates = version.transitions
    .filter((t) => t.fromTrackId === input.trackId && age >= t.atAgeYears)
    .slice()
    .sort((a, b) => b.atAgeYears - a.atAgeYears);
  const rule = candidates[0];
  if (!rule) return { applies: false };

  const mapped = input.currentStepId
    ? rule.mapping.find((m) => m.fromStepId === input.currentStepId)
    : undefined;

  return mapped
    ? { applies: true, toTrackId: rule.toTrackId, toStepId: mapped.toStepId }
    : { applies: true, toTrackId: rule.toTrackId };
}
