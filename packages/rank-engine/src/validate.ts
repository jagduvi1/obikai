import { z } from 'zod';
import type {
  CriterionLeaf,
  PromotionCriterion,
  Step,
  TransitionRule,
  ValidatedSystemDraft,
  ValidationIssue,
  ValidationResult,
} from './types.js';

/**
 * validateConfig is the ONLY ingress for AI- or human-authored config (ADR-0005). Nothing reaches
 * the deterministic evaluator without passing this: a Zod shape check followed by structural
 * integrity checks (coherent ordering, valid references, no cycles). This is the structural AI
 * firewall — AI can propose config, but only a validated, human-approved draft can be minted.
 */

// Branded ids are structurally strings; validate as string, type as the brand.
function idSchema<T extends string>(): z.ZodType<T> {
  return z.string().min(1) as unknown as z.ZodType<T>;
}

const enforcementSchema = z.enum(['required', 'advisory']);

const leafSchema: z.ZodType<CriterionLeaf> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('minTimeAtStep'),
    enforcement: enforcementSchema,
    months: z.number().int().nonnegative().optional(),
    days: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal('minClassesSinceLastPromotion'),
    enforcement: enforcementSchema,
    count: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('minTotalClasses'),
    enforcement: enforcementSchema,
    count: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('minAge'),
    enforcement: enforcementSchema,
    years: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('prerequisiteStep'),
    enforcement: enforcementSchema,
    stepId: idSchema(),
  }),
  z.object({
    type: z.literal('requiredCurriculumItems'),
    enforcement: enforcementSchema,
    itemIds: z.array(z.string().min(1)),
  }),
  z.object({
    type: z.literal('passedGradingEvent'),
    enforcement: enforcementSchema,
    sinceStepId: idSchema().optional(),
  }),
  z.object({
    type: z.literal('manualInstructorSignOff'),
    enforcement: enforcementSchema,
    role: z.enum(['instructor', 'owner']).optional(),
  }),
]) as z.ZodType<CriterionLeaf>;

const criterionSchema: z.ZodType<PromotionCriterion> = z.lazy(() =>
  z.union([
    leafSchema,
    z.object({ type: z.literal('allOf'), criteria: z.array(criterionSchema) }),
    z.object({ type: z.literal('anyOf'), criteria: z.array(criterionSchema) }),
  ]),
);

const visualSchema = z.object({
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  pattern: z.enum(['solid', 'split', 'striped']).optional(),
  stripeCount: z.number().int().nonnegative().optional(),
  stripeColor: z.string().optional(),
  imageRef: z.string().optional(),
});

const stepSchema = z.object({
  id: idSchema(),
  kind: z.enum(['rank', 'marker', 'dan', 'level']),
  order: z.number().int(),
  trackId: idSchema(),
  parentStepId: idSchema().optional(),
  visual: visualSchema,
  criteria: criterionSchema,
  curriculumId: idSchema().optional(),
});

const draftSchema = z.object({
  disciplineId: idSchema(),
  systemId: idSchema(),
  presentation: z.enum(['belt', 'sash', 'armband', 'level', 'tier', 'none']),
  tracks: z
    .array(
      z.object({
        id: idSchema(),
        minAgeYears: z.number().int().optional(),
        maxAgeYears: z.number().int().optional(),
      }),
    )
    .min(1),
  ladder: z.array(stepSchema).min(1),
  transitions: z.array(
    z.object({
      fromTrackId: idSchema(),
      toTrackId: idSchema(),
      atAgeYears: z.number().int().nonnegative(),
      mapping: z.array(z.object({ fromStepId: idSchema(), toStepId: idSchema() })),
    }),
  ),
  curricula: z.array(
    z.object({
      id: idSchema(),
      groups: z.array(z.object({ id: z.string(), itemIds: z.array(z.string()) })),
    }),
  ),
});

function collectLeaves(node: PromotionCriterion, out: CriterionLeaf[]): void {
  if (node.type === 'allOf' || node.type === 'anyOf') {
    for (const child of node.criteria) collectLeaves(child, out);
  } else {
    out.push(node);
  }
}

function structuralIssues(draft: ValidatedSystemDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const trackIds = new Set(draft.tracks.map((t) => t.id));
  const stepById = new Map(draft.ladder.map((s) => [s.id, s] as const));
  const curriculaIds = new Set(draft.curricula.map((c) => c.id));
  const curriculumItemIds = new Set(
    draft.curricula.flatMap((c) => c.groups.flatMap((g) => g.itemIds)),
  );

  // Unique track ids
  if (trackIds.size !== draft.tracks.length) {
    issues.push({ code: 'DUP_TRACK', path: 'tracks', messageKey: 'validation.tracks.duplicate' });
  }

  // Per-track ordering must be strictly increasing & unique (so the evaluator's sort is total)
  const byTrack = new Map<string, Step[]>();
  for (const step of draft.ladder) {
    if (!trackIds.has(step.trackId)) {
      issues.push({
        code: 'BAD_TRACK_REF',
        path: `ladder.${step.id}.trackId`,
        messageKey: 'validation.step.unknownTrack',
      });
    }
    const arr = byTrack.get(step.trackId) ?? [];
    arr.push(step);
    byTrack.set(step.trackId, arr);
  }
  for (const [trackId, steps] of byTrack) {
    const orders = steps.map((s) => s.order);
    if (new Set(orders).size !== orders.length) {
      issues.push({
        code: 'DUP_ORDER',
        path: `track.${trackId}`,
        messageKey: 'validation.step.duplicateOrder',
      });
    }
    const ranks = steps.filter((s) => s.kind === 'rank');
    const dans = steps.filter((s) => s.kind === 'dan');
    if (ranks.length && dans.length) {
      const maxRank = Math.max(...ranks.map((s) => s.order));
      const minDan = Math.min(...dans.map((s) => s.order));
      if (minDan <= maxRank) {
        issues.push({
          code: 'DAN_BEFORE_RANK',
          path: `track.${trackId}`,
          messageKey: 'validation.step.danBeforeRank',
        });
      }
    }
  }

  // Per-step reference checks
  for (const step of draft.ladder) {
    if (step.kind === 'marker') {
      if (!step.parentStepId) {
        issues.push({
          code: 'MARKER_NO_PARENT',
          path: `ladder.${step.id}`,
          messageKey: 'validation.marker.noParent',
        });
      } else {
        const parent = stepById.get(step.parentStepId);
        if (!parent || parent.trackId !== step.trackId || parent.order >= step.order) {
          issues.push({
            code: 'MARKER_BAD_PARENT',
            path: `ladder.${step.id}.parentStepId`,
            messageKey: 'validation.marker.badParent',
          });
        }
      }
    }
    if (step.curriculumId && !curriculaIds.has(step.curriculumId)) {
      issues.push({
        code: 'BAD_CURRICULUM_REF',
        path: `ladder.${step.id}.curriculumId`,
        messageKey: 'validation.step.unknownCurriculum',
      });
    }
    const leaves: CriterionLeaf[] = [];
    collectLeaves(step.criteria, leaves);
    for (const leaf of leaves) {
      if (leaf.type === 'prerequisiteStep') {
        const pre = stepById.get(leaf.stepId);
        if (!pre) {
          issues.push({
            code: 'BAD_PREREQ',
            path: `ladder.${step.id}.criteria`,
            messageKey: 'validation.criteria.unknownPrerequisite',
          });
        } else if (pre.trackId === step.trackId && pre.order >= step.order) {
          issues.push({
            code: 'PREREQ_NOT_EARLIER',
            path: `ladder.${step.id}.criteria`,
            messageKey: 'validation.criteria.prerequisiteNotEarlier',
          });
        }
      }
      if (leaf.type === 'requiredCurriculumItems') {
        for (const item of leaf.itemIds) {
          if (!curriculumItemIds.has(item)) {
            issues.push({
              code: 'BAD_CURRICULUM_ITEM',
              path: `ladder.${step.id}.criteria`,
              messageKey: 'validation.criteria.unknownCurriculumItem',
            });
            break;
          }
        }
      }
    }
  }

  // Transition mappings
  for (const t of draft.transitions as readonly TransitionRule[]) {
    if (!trackIds.has(t.fromTrackId) || !trackIds.has(t.toTrackId)) {
      issues.push({
        code: 'BAD_TRANSITION_TRACK',
        path: 'transitions',
        messageKey: 'validation.transition.unknownTrack',
      });
    }
    for (const m of t.mapping) {
      const from = stepById.get(m.fromStepId);
      const to = stepById.get(m.toStepId);
      if (!from || from.trackId !== t.fromTrackId) {
        issues.push({
          code: 'BAD_TRANSITION_FROM',
          path: 'transitions.mapping',
          messageKey: 'validation.transition.badFrom',
        });
      }
      if (!to || to.trackId !== t.toTrackId) {
        issues.push({
          code: 'BAD_TRANSITION_TO',
          path: 'transitions.mapping',
          messageKey: 'validation.transition.badTo',
        });
      }
    }
  }

  return issues;
}

export function validateConfig(candidate: unknown): ValidationResult {
  const parsed = draftSchema.safeParse(candidate);
  if (!parsed.success) {
    const errors: ValidationIssue[] = parsed.error.issues.map((i) => ({
      code: 'SHAPE',
      path: i.path.join('.'),
      messageKey: i.message,
    }));
    return { valid: false, errors };
  }
  // Runtime shape is zod-validated; branded ids are structurally strings, so assert the nominal type.
  const draft = parsed.data as unknown as ValidatedSystemDraft;
  const issues = structuralIssues(draft);
  if (issues.length > 0) return { valid: false, errors: issues };
  return { valid: true, draft };
}
