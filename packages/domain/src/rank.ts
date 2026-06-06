import { z } from 'zod';
import type {
  CurriculumCompletionId,
  CurriculumId,
  CurriculumItemId,
  DisciplineId,
  GradingEventId,
  MemberId,
  PromotionId,
  RankStateId,
  StepId,
  SystemId,
  TenantId,
  TrackId,
  VersionId,
} from './ids.js';
import type { Instant } from './result.js';

/**
 * The rank/grading/curriculum model (ADR-0005/0015). The CANONICAL rank-system model
 * (ProgressionSystemVersion, Step, criteria, eligibility/promotion I/O) lives HERE in the shared
 * domain core — the pure `@obikai/rank-engine` evaluates over it, `@obikai/db` persists it, and the
 * api exposes it. "Belt" is presentation only (`VisualSpec`), never read during evaluation: one
 * model covers belts + stripes, kyu/dan, levels/tiers, and belt-less arts.
 *
 * The §-Engine section below is the immutable, deterministic model the evaluator consumes. The
 * §-App section adds the surrounding business entities the engine never touches (Discipline, a
 * member's RankState, GradingEvent, CurriculumItem content, completions, persisted Promotions).
 */

// ───────────────────────────── §-Engine: canonical model ────────────────────────────────────────

export type PresentationStyle = 'belt' | 'sash' | 'armband' | 'level' | 'tier' | 'none';

/** A step in the ladder is one of these kinds; criteria/curriculum/history attach identically. */
export type StepKind = 'rank' | 'marker' | 'dan' | 'level';

/** Opaque-to-the-evaluator visual payload. NEVER read during eligibility/promotion. */
export interface VisualSpec {
  readonly primaryColor?: string;
  readonly secondaryColor?: string;
  readonly pattern?: 'solid' | 'split' | 'striped';
  readonly stripeCount?: number;
  readonly stripeColor?: string;
  /** Storage key, never a URL the engine resolves. */
  readonly imageRef?: string;
}

export type Enforcement = 'required' | 'advisory';

/** Leaf criteria — a discriminated union for exhaustive compile-time checks. */
export type CriterionLeaf =
  | {
      readonly type: 'minTimeAtStep';
      readonly enforcement: Enforcement;
      readonly months?: number;
      readonly days?: number;
    }
  | {
      readonly type: 'minClassesSinceLastPromotion';
      readonly enforcement: Enforcement;
      readonly count: number;
    }
  | { readonly type: 'minTotalClasses'; readonly enforcement: Enforcement; readonly count: number }
  | { readonly type: 'minAge'; readonly enforcement: Enforcement; readonly years: number }
  | {
      readonly type: 'prerequisiteStep';
      readonly enforcement: Enforcement;
      readonly stepId: StepId;
    }
  | {
      readonly type: 'requiredCurriculumItems';
      readonly enforcement: Enforcement;
      readonly itemIds: readonly string[];
    }
  | {
      readonly type: 'passedGradingEvent';
      readonly enforcement: Enforcement;
      readonly sinceStepId?: StepId;
    }
  | {
      readonly type: 'manualInstructorSignOff';
      readonly enforcement: Enforcement;
      readonly role?: 'instructor' | 'owner';
    };

export type CriterionLeafType = CriterionLeaf['type'];

/** Composable AND/OR tree. The common case is a single `allOf`. */
export type PromotionCriterion =
  | CriterionLeaf
  | { readonly type: 'allOf'; readonly criteria: readonly PromotionCriterion[] }
  | { readonly type: 'anyOf'; readonly criteria: readonly PromotionCriterion[] };

export interface Track {
  readonly id: TrackId;
  readonly minAgeYears?: number;
  readonly maxAgeYears?: number;
}

export interface Step {
  readonly id: StepId;
  readonly kind: StepKind;
  /** Strictly increasing within a track; defines the ladder. */
  readonly order: number;
  readonly trackId: TrackId;
  /** For markers/stripes nested under a parent rank. */
  readonly parentStepId?: StepId;
  readonly visual: VisualSpec;
  readonly criteria: PromotionCriterion;
  readonly curriculumId?: CurriculumId;
}

export interface TransitionRule {
  readonly fromTrackId: TrackId;
  readonly toTrackId: TrackId;
  readonly atAgeYears: number;
  readonly mapping: readonly { readonly fromStepId: StepId; readonly toStepId: StepId }[];
}

export interface Curriculum {
  readonly id: CurriculumId;
  readonly groups: readonly { readonly id: string; readonly itemIds: readonly string[] }[];
}

/** IMMUTABLE once minted. The only thing the evaluator accepts. */
export interface ProgressionSystemVersion {
  readonly systemId: SystemId;
  readonly versionId: VersionId;
  /** Monotonic human-facing version number (1, 2, 3 …). */
  readonly version: number;
  readonly disciplineId: DisciplineId;
  readonly presentation: PresentationStyle;
  readonly tracks: readonly Track[];
  readonly ladder: readonly Step[];
  readonly transitions: readonly TransitionRule[];
  readonly curricula: readonly Curriculum[];
  /** Hash over the canonical content; basis of versionId and dedupe. */
  readonly contentHash: string;
}

/** Logical handle the app stores; points at immutable versions. */
export interface ProgressionSystem {
  readonly id: SystemId;
  readonly disciplineId: DisciplineId;
  readonly currentVersionId: VersionId;
  readonly versionIds: readonly VersionId[];
}

// ── Inputs the APP supplies (the engine never fetches these) ──────────────────

export interface EvaluationContext {
  /** Injected clock; no Date.now() inside the engine (ADR-0005). */
  readonly now: Instant;
  /** Pinned tenant IANA timezone for calendar/age math — never the viewer's zone. */
  readonly zone: string;
}

export interface GradingResult {
  readonly stepId: StepId;
  readonly passed: boolean;
  readonly at: Instant;
}

export interface ManualSignOff {
  readonly stepId: StepId;
  readonly byRole: 'instructor' | 'owner';
  readonly at: Instant;
  readonly signerId: string;
}

export interface StudentProgressionInput {
  readonly systemVersionId: VersionId;
  readonly trackId: TrackId;
  /** null = pre-first-step (e.g. white-belt entry). */
  readonly currentStepId: StepId | null;
  readonly enteredCurrentStepAt: Instant;
  readonly dateOfBirth?: Instant;
  /** App-computed "classes since last promotion in this discipline" (scope §7). */
  readonly attendanceSinceLastPromotion: number;
  readonly totalAttendance: number;
  readonly completedCurriculumItemIds: readonly string[];
  readonly gradingResults: readonly GradingResult[];
  readonly manualSignOffs: readonly ManualSignOff[];
}

// ── Outputs ───────────────────────────────────────────────────────────────────

export type ProgressUnit = 'days' | 'classes' | 'years' | 'items' | 'boolean';

export interface CriterionProgress {
  readonly current: number;
  readonly target: number;
  readonly remaining: number;
  readonly unit: ProgressUnit;
  /** Clamped 0..1. */
  readonly fractionComplete: number;
}

export interface CriterionEvaluation {
  readonly type: CriterionLeafType;
  readonly enforcement: Enforcement;
  readonly satisfied: boolean;
  readonly progress: CriterionProgress;
  /** i18n key, e.g. 'criteria.minTimeAtStep.shortBy'. */
  readonly reasonKey: string;
}

/** The dashboard's three buckets (scope §4.5). Gated ONLY by required criteria — advisory
 * criteria are nudges and never block 'ready'. 'close' = every unmet required is ≥50% there. */
export type EligibilityStatus = 'ready' | 'close' | 'notYet';

export interface StepEligibility {
  readonly stepId: StepId;
  readonly status: EligibilityStatus;
  readonly criteria: readonly CriterionEvaluation[];
  readonly unmetRequired: readonly CriterionLeafType[];
  readonly unmetAdvisory: readonly CriterionLeafType[];
}

export interface EligibilityResult {
  readonly systemVersionId: VersionId;
  readonly evaluatedAt: Instant;
  readonly nextSteps: readonly StepEligibility[];
}

export interface PromotionLogEntry {
  readonly systemId: SystemId;
  /** Pins the exact version granted under (invariant 5). */
  readonly systemVersionId: VersionId;
  readonly fromStepId: StepId | null;
  readonly toStepId: StepId;
  readonly awardedAt: Instant;
  readonly awardedByRole: 'instructor' | 'owner';
  readonly awardingUserId: string;
  /** What was true at award time, frozen (canonically ordered). */
  readonly satisfiedSnapshot: readonly CriterionEvaluation[];
  /** Set iff a human force-promoted past an unmet required criterion. Never AI-populated. */
  readonly overrideReason?: string;
}

export type PromoteOutcome =
  | { readonly ok: true; readonly entry: PromotionLogEntry }
  | {
      readonly ok: false;
      readonly reason: 'requiredCriteriaUnmet';
      readonly unmet: readonly CriterionLeafType[];
    }
  | {
      readonly ok: false;
      readonly reason: 'unknownStep';
      readonly unmet: readonly CriterionLeafType[];
    };

// ── Config validation ──────────────────────────────────────────────────────────

export interface ValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly messageKey: string;
}

/** A validated, hash-ready draft (no versionId/contentHash yet — those are minted). */
export interface ValidatedSystemDraft {
  readonly disciplineId: DisciplineId;
  readonly systemId: SystemId;
  readonly presentation: PresentationStyle;
  readonly tracks: readonly Track[];
  readonly ladder: readonly Step[];
  readonly transitions: readonly TransitionRule[];
  readonly curricula: readonly Curriculum[];
}

export type ValidationResult =
  | { readonly valid: true; readonly draft: ValidatedSystemDraft }
  | { readonly valid: false; readonly errors: readonly ValidationIssue[] };

// ───────────────────────────── §-App: business entities ─────────────────────────────────────────

/**
 * A discipline = one art a dojo teaches (BJJ, Karate, Judo …). It owns a ProgressionSystem and is
 * the unit attendance/classes are counted against (scope §7). `presentation` is a default for new
 * systems; the authoritative presentation lives on each minted version.
 */
export interface Discipline {
  readonly id: DisciplineId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly description: string | null;
  readonly presentation: PresentationStyle;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A member's CURRENT position in one discipline. Advanced ONLY by recording a Promotion. */
export interface MemberRankState {
  readonly id: RankStateId;
  readonly tenantId: TenantId;
  readonly memberId: MemberId;
  readonly disciplineId: DisciplineId;
  readonly systemId: SystemId;
  readonly trackId: TrackId;
  /** null = pre-first-step (entry / white belt). */
  readonly currentStepId: StepId | null;
  readonly enteredCurrentStepAt: string;
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const GRADING_EVENT_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
export type GradingEventStatus = (typeof GRADING_EVENT_STATUSES)[number];

/** A scheduled grading/test for a discipline; results feed `passedGradingEvent` criteria. */
export interface GradingEvent {
  readonly id: GradingEventId;
  readonly tenantId: TenantId;
  readonly disciplineId: DisciplineId;
  readonly name: string;
  readonly scheduledAt: string;
  readonly locationId: string | null;
  readonly status: GradingEventStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A pass/fail outcome recorded for one member at a grading event, for one candidate step. */
export interface GradingResultRecord {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly gradingEventId: GradingEventId;
  readonly memberId: MemberId;
  readonly stepId: StepId;
  readonly passed: boolean;
  readonly recordedByUserId: string;
  readonly recordedAt: string;
  readonly notes: string | null;
}

/**
 * Human content for a curriculum item id (technique/form). The engine's `Curriculum` references
 * opaque `itemIds`; this gives them translatable labels/media for the UI and "my progress" view.
 */
export interface CurriculumItem {
  readonly id: CurriculumItemId;
  readonly tenantId: TenantId;
  readonly disciplineId: DisciplineId;
  /** The engine-facing item id used inside a ProgressionSystemVersion's curricula. */
  readonly itemKey: string;
  readonly label: string;
  readonly description: string | null;
  readonly mediaRef: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A student's completion of one curriculum item, feeding `completedCurriculumItemIds`. */
export interface CurriculumCompletion {
  readonly id: CurriculumCompletionId;
  readonly tenantId: TenantId;
  readonly memberId: MemberId;
  readonly disciplineId: DisciplineId;
  readonly itemKey: string;
  readonly completedAt: string;
  readonly markedByUserId: string;
}

/**
 * A persisted promotion — the immutable engine `PromotionLogEntry` wrapped with tenant/member/
 * discipline identity. Append-only: promotion history is never edited (invariant 5).
 */
export interface Promotion {
  readonly id: PromotionId;
  readonly tenantId: TenantId;
  readonly memberId: MemberId;
  readonly disciplineId: DisciplineId;
  readonly systemId: SystemId;
  readonly systemVersionId: VersionId;
  readonly fromStepId: StepId | null;
  readonly toStepId: StepId;
  readonly awardedAt: string;
  readonly awardedByRole: 'instructor' | 'owner';
  readonly awardingUserId: string;
  readonly satisfiedSnapshot: readonly CriterionEvaluation[];
  readonly overrideReason: string | null;
  readonly createdAt: string;
}

// ── Zod create inputs (API DTOs) ───────────────────────────────────────────────
const presentationEnum = z.enum(['belt', 'sash', 'armband', 'level', 'tier', 'none']);

export const disciplineCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  presentation: presentationEnum.default('belt'),
  active: z.boolean().default(true),
});
export type DisciplineCreateInput = z.infer<typeof disciplineCreateSchema>;

export const disciplineUpdateSchema = disciplineCreateSchema.partial();
export type DisciplineUpdateInput = z.infer<typeof disciplineUpdateSchema>;

export const gradingEventCreateSchema = z.object({
  disciplineId: z.string().min(1),
  name: z.string().min(1),
  scheduledAt: z.string().datetime(),
  locationId: z.string().min(1).nullable().optional(),
});
export type GradingEventCreateInput = z.infer<typeof gradingEventCreateSchema>;

export const gradingResultCreateSchema = z.object({
  memberId: z.string().min(1),
  stepId: z.string().min(1),
  passed: z.boolean(),
  notes: z.string().nullable().optional(),
});
export type GradingResultCreateInput = z.infer<typeof gradingResultCreateSchema>;

export const curriculumItemCreateSchema = z.object({
  disciplineId: z.string().min(1),
  itemKey: z.string().min(1),
  label: z.string().min(1),
  description: z.string().nullable().optional(),
  mediaRef: z.string().min(1).nullable().optional(),
});
export type CurriculumItemCreateInput = z.infer<typeof curriculumItemCreateSchema>;
