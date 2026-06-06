import { type StepId, brand } from '@obikai/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluateEligibility, mintVersion, promote, validateConfig } from '../src/index.js';
import {
  DAY,
  STATUS_RANK,
  YEAR,
  classOnlySystem,
  instant,
  makeInput,
  sampleSystem,
} from './builders.js';

describe('evaluateEligibility — example cases', () => {
  it('reports the immediate next step with per-criterion "how close"', () => {
    const sys = sampleSystem();
    const res = evaluateEligibility(sys, makeInput({ attendanceSinceLastPromotion: 50 }), {
      now: instant(0),
      zone: 'Europe/Stockholm',
    });
    expect(res.nextSteps).toHaveLength(1);
    const blue = res.nextSteps[0]!;
    expect(blue.stepId).toBe('blue');
    const classes = blue.criteria.find((c) => c.type === 'minClassesSinceLastPromotion')!;
    expect(classes.progress).toMatchObject({ current: 50, target: 100, remaining: 50 });
    expect(classes.satisfied).toBe(false);
    // time (0d) and the manual sign-off are both far off, so the student is not yet close.
    expect(blue.status).toBe('notYet');
  });

  it('is "ready" only once every required criterion is met', () => {
    const sys = sampleSystem();
    const res = evaluateEligibility(
      sys,
      makeInput({
        attendanceSinceLastPromotion: 120,
        manualSignOffs: [
          { stepId: brand<StepId>('blue'), byRole: 'instructor', at: instant(0), signerId: 'u1' },
        ],
      }),
      { now: instant(2 * YEAR), zone: 'Europe/Stockholm' },
    );
    expect(res.nextSteps[0]!.status).toBe('ready');
    expect(res.nextSteps[0]!.unmetRequired).toEqual([]);
  });

  it('returns no next step when the student is at the top of the ladder', () => {
    const sys = sampleSystem();
    const res = evaluateEligibility(sys, makeInput({ currentStepId: brand<StepId>('blue') }), {
      now: instant(0),
      zone: 'Europe/Stockholm',
    });
    expect(res.nextSteps).toEqual([]);
  });
});

describe('promote — never auto-promotes past unmet required criteria (invariant 4/5)', () => {
  const sys = sampleSystem();
  const ctx = { now: instant(2 * YEAR), zone: 'Europe/Stockholm' };

  it('refuses when a required criterion is unmet and no human override is given', () => {
    const out = promote(
      sys,
      makeInput({ attendanceSinceLastPromotion: 10 }),
      { toStepId: brand<StepId>('blue'), byRole: 'instructor', userId: 'u1' },
      ctx,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('requiredCriteriaUnmet');
  });

  it('allows a human force-promote with an explicit overrideReason, recording it immutably', () => {
    const out = promote(
      sys,
      makeInput({ attendanceSinceLastPromotion: 10 }),
      {
        toStepId: brand<StepId>('blue'),
        byRole: 'owner',
        userId: 'u1',
        overrideReason: 'tournament gold; instructor discretion',
      },
      ctx,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.entry.systemVersionId).toBe(sys.versionId);
      expect(out.entry.overrideReason).toContain('discretion');
      expect(out.entry.fromStepId).toBe('white');
      expect(out.entry.toStepId).toBe('blue');
    }
  });

  it('rejects an unknown target step', () => {
    const out = promote(
      sys,
      makeInput(),
      { toStepId: brand<StepId>('purple'), byRole: 'owner', userId: 'u1' },
      ctx,
    );
    expect(out.ok).toBe(false);
  });
});

describe('properties (fast-check)', () => {
  const ctx = { now: instant(10 * YEAR), zone: 'Europe/Stockholm' };

  it('is deterministic: identical inputs always yield identical output', () => {
    const sys = sampleSystem();
    fc.assert(
      fc.property(fc.nat({ max: 500 }), fc.nat({ max: 5000 }), (since, total) => {
        const input = makeInput({ attendanceSinceLastPromotion: since, totalAttendance: total });
        const a = evaluateEligibility(sys, input, ctx);
        const b = evaluateEligibility(sys, input, ctx);
        expect(a).toEqual(b);
      }),
    );
  });

  it('is monotonic: more attendance never lowers eligibility status', () => {
    const sys = classOnlySystem(100);
    fc.assert(
      fc.property(fc.nat({ max: 300 }), fc.nat({ max: 300 }), (x, y) => {
        const lo = Math.min(x, y);
        const hi = Math.max(x, y);
        const base = makeInput({ currentStepId: brand<StepId>('a') });
        const sLo = evaluateEligibility(sys, { ...base, attendanceSinceLastPromotion: lo }, ctx)
          .nextSteps[0]!;
        const sHi = evaluateEligibility(sys, { ...base, attendanceSinceLastPromotion: hi }, ctx)
          .nextSteps[0]!;
        expect(STATUS_RANK[sHi.status]!).toBeGreaterThanOrEqual(STATUS_RANK[sLo.status]!);
      }),
    );
  });

  it('is invariant under reordering of input collections (grading/sign-offs)', () => {
    const sys = sampleSystem();
    const signoffs = [
      {
        stepId: brand<StepId>('blue'),
        byRole: 'instructor' as const,
        at: instant(0),
        signerId: 'a',
      },
      { stepId: brand<StepId>('blue'), byRole: 'owner' as const, at: instant(1), signerId: 'b' },
    ];
    const input1 = makeInput({ attendanceSinceLastPromotion: 120, manualSignOffs: signoffs });
    const input2 = makeInput({
      attendanceSinceLastPromotion: 120,
      manualSignOffs: [...signoffs].reverse(),
    });
    expect(evaluateEligibility(sys, input1, ctx)).toEqual(evaluateEligibility(sys, input2, ctx));
  });

  it('minTimeAtStep is stable across timezones for a far-past entry', () => {
    const sys = sampleSystem({ blueMonths: 6, blueClasses: 0 });
    const input = makeInput({ enteredCurrentStepAt: instant(0), attendanceSinceLastPromotion: 0 });
    const zones = ['Europe/Stockholm', 'UTC', 'Pacific/Kiritimati', 'America/Los_Angeles'];
    const results = zones.map(
      (zone) =>
        evaluateEligibility(sys, input, {
          now: instant(2 * YEAR),
          zone,
        }).nextSteps[0]!.criteria.find((c) => c.type === 'minTimeAtStep')!.satisfied,
    );
    expect(new Set(results).size).toBe(1); // all agree the 6-month threshold is met
  });
});

describe('mintVersion — canonical, content-addressed versioning (invariant 5)', () => {
  function deepReorderKeys(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(deepReorderKeys);
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    return Object.fromEntries(entries.map(([k, v]) => [k, deepReorderKeys(v)]));
  }

  const candidate = {
    disciplineId: 'bjj',
    systemId: 'bjj-adult',
    presentation: 'belt',
    tracks: [{ id: 'adult' }],
    ladder: [
      {
        id: 'white',
        kind: 'rank',
        order: 0,
        trackId: 'adult',
        visual: {},
        criteria: { type: 'allOf', criteria: [] },
      },
      {
        id: 'blue',
        kind: 'rank',
        order: 10,
        trackId: 'adult',
        visual: {},
        criteria: { type: 'minClassesSinceLastPromotion', enforcement: 'required', count: 100 },
      },
    ],
    transitions: [],
    curricula: [],
  };

  it('produces the same versionId for logically-identical configs (key order irrelevant)', () => {
    const a = validateConfig(candidate);
    const b = validateConfig(deepReorderKeys(candidate));
    expect(a.valid && b.valid).toBe(true);
    if (a.valid && b.valid) {
      expect(mintVersion(null, a.draft).versionId).toBe(mintVersion(null, b.draft).versionId);
    }
  });

  it('produces a different versionId on any semantic change', () => {
    const a = validateConfig(candidate);
    const changed = structuredClone(candidate);
    (changed.ladder[1]!.criteria as { count: number }).count = 101;
    const b = validateConfig(changed);
    expect(a.valid && b.valid).toBe(true);
    if (a.valid && b.valid) {
      expect(mintVersion(null, a.draft).versionId).not.toBe(mintVersion(null, b.draft).versionId);
    }
  });

  it('does not mint a new version when re-minting unchanged content', () => {
    const a = validateConfig(candidate);
    if (!a.valid) throw new Error('invalid');
    const v1 = mintVersion(null, a.draft);
    const v2 = mintVersion(v1, a.draft);
    expect(v2).toBe(v1);
    expect(v2.version).toBe(1);
  });
});

describe('validateConfig — structural integrity', () => {
  const ok = {
    disciplineId: 'd',
    systemId: 's',
    presentation: 'belt',
    tracks: [{ id: 'adult' }],
    ladder: [
      {
        id: 'a',
        kind: 'rank',
        order: 0,
        trackId: 'adult',
        visual: {},
        criteria: { type: 'allOf', criteria: [] },
      },
    ],
    transitions: [],
    curricula: [],
  };

  it('accepts a coherent config', () => {
    expect(validateConfig(ok).valid).toBe(true);
  });

  it('rejects duplicate order within a track', () => {
    const bad = {
      ...ok,
      ladder: [
        {
          id: 'a',
          kind: 'rank',
          order: 0,
          trackId: 'adult',
          visual: {},
          criteria: { type: 'allOf', criteria: [] },
        },
        {
          id: 'b',
          kind: 'rank',
          order: 0,
          trackId: 'adult',
          visual: {},
          criteria: { type: 'allOf', criteria: [] },
        },
      ],
    };
    const res = validateConfig(bad);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.errors.some((e) => e.code === 'DUP_ORDER')).toBe(true);
  });

  it('rejects a dan step ordered before a rank step', () => {
    const bad = {
      ...ok,
      ladder: [
        {
          id: 'd1',
          kind: 'dan',
          order: 0,
          trackId: 'adult',
          visual: {},
          criteria: { type: 'allOf', criteria: [] },
        },
        {
          id: 'r1',
          kind: 'rank',
          order: 5,
          trackId: 'adult',
          visual: {},
          criteria: { type: 'allOf', criteria: [] },
        },
      ],
    };
    const res = validateConfig(bad);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.errors.some((e) => e.code === 'DAN_BEFORE_RANK')).toBe(true);
  });

  it('rejects a marker without a valid parent', () => {
    const bad = {
      ...ok,
      ladder: [
        {
          id: 'a',
          kind: 'rank',
          order: 0,
          trackId: 'adult',
          visual: {},
          criteria: { type: 'allOf', criteria: [] },
        },
        {
          id: 'm',
          kind: 'marker',
          order: 1,
          trackId: 'adult',
          visual: {},
          criteria: { type: 'allOf', criteria: [] },
        },
      ],
    };
    const res = validateConfig(bad);
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.errors.some((e) => e.code === 'MARKER_NO_PARENT')).toBe(true);
  });
});
