/**
 * The canonical rank model now lives in `@obikai/domain` (the shared core: entities in domain, the
 * pure evaluator here in the engine, persistence in @obikai/db — ADR-0005/0015). This module
 * re-exports the rank types so the engine's internal imports and public surface are unchanged, and
 * the dependency-boundary "rank-engine may import only domain" still holds.
 */
export type {
  PresentationStyle,
  StepKind,
  VisualSpec,
  Enforcement,
  CriterionLeaf,
  CriterionLeafType,
  PromotionCriterion,
  Track,
  Step,
  TransitionRule,
  Curriculum,
  ProgressionSystemVersion,
  ProgressionSystem,
  EvaluationContext,
  GradingResult,
  ManualSignOff,
  StudentProgressionInput,
  ProgressUnit,
  CriterionProgress,
  CriterionEvaluation,
  EligibilityStatus,
  StepEligibility,
  EligibilityResult,
  PromotionLogEntry,
  PromoteOutcome,
  ValidationIssue,
  ValidatedSystemDraft,
  ValidationResult,
} from '@obikai/domain';
