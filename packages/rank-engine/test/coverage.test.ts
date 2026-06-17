import { type StepId, brand } from '@obikai/domain';
import { describe, expect, it } from 'vitest';
import {
  type ProgressionSystemVersion,
  type PromotionCriterion,
  evaluateEligibility,
  mintVersion,
  validateConfig,
} from '../src/index.js';
import { YEAR, instant, makeInput } from './builders.js';

const CTX = { now: instant(40 * YEAR), zone: 'Europe/Stockholm' };

/** Build a minimal a→b level ladder where step `b` carries the given criteria. */
function ladder(bCriteria: PromotionCriterion): ProgressionSystemVersion {
  const candidate = {
    disciplineId: 'd',
    systemId: 's',
    presentation: 'level',
    tracks: [{ id: 'adult' }],
    ladder: [
      {
        id: 'a',
        kind: 'level',
        order: 0,
        trackId: 'adult',
        visual: {},
        criteria: { type: 'allOf', criteria: [] },
      },
      { id: 'b', kind: 'level', order: 1, trackId: 'adult', visual: {}, criteria: bCriteria },
    ],
    transitions: [],
    curricula: [],
  };
  const res = validateConfig(candidate);
  if (!res.valid) throw new Error(`invalid config: ${JSON.stringify(res.errors)}`);
  return mintVersion(null, res.draft);
}

const nextB = (sys: ProgressionSystemVersion, partial = {}) =>
  evaluateEligibility(sys, makeInput({ currentStepId: brand<StepId>('a'), ...partial }), CTX)
    .nextSteps[0]!;

describe('rank-engine leaf coverage (invariant 7)', () => {
  it('minTotalClasses: satisfied / unsatisfied + progress', () => {
    const sys = ladder({ type: 'minTotalClasses', enforcement: 'required', count: 100 });
    expect(nextB(sys, { totalAttendance: 100 }).status).toBe('ready');
    const partial = nextB(sys, { totalAttendance: 80 });
    expect(partial.status).toBe('close'); // 0.8 ≥ 0.5
    expect(partial.criteria.find((c) => c.type === 'minTotalClasses')?.progress).toMatchObject({
      current: 80,
      target: 100,
    });
  });

  it('passedGradingEvent: matches a passed grading recorded for the target step', () => {
    const sys = ladder({ type: 'passedGradingEvent', enforcement: 'required' });
    expect(nextB(sys).status).toBe('notYet');
    const ready = nextB(sys, {
      gradingResults: [{ stepId: brand<StepId>('b'), passed: true, at: instant(0) }],
    });
    expect(ready.status).toBe('ready');
    // A passed grading for a DIFFERENT step does not satisfy it.
    expect(
      nextB(sys, { gradingResults: [{ stepId: brand<StepId>('a'), passed: true, at: instant(0) }] })
        .status,
    ).toBe('notYet');
  });

  it('minAge: uses dateOfBirth against the evaluation clock', () => {
    const sys = ladder({ type: 'minAge', enforcement: 'required', years: 16 });
    // Born at epoch 0; CTX.now is 40y later → age 40 ≥ 16.
    expect(nextB(sys, { dateOfBirth: instant(0) }).status).toBe('ready');
    // Born 2y before CTX.now → age 2, well under half of 16 → notYet.
    expect(nextB(sys, { dateOfBirth: instant(38 * YEAR) }).status).toBe('notYet');
  });

  it('prerequisiteStep (same track): met once the student is at/after the prerequisite', () => {
    // a(0) → b(1): b requires prerequisite 'a'. From 'a', order 0 ≥ 0 → met.
    const sys = ladder({
      type: 'prerequisiteStep',
      enforcement: 'required',
      stepId: brand<StepId>('a'),
    });
    expect(nextB(sys).status).toBe('ready');
  });
});

describe('rank-engine anyOf bucketing (audit fix)', () => {
  it('a satisfied anyOf branch never drags close/notYet down via a shared criterion type', () => {
    // allOf[ minTotalClasses(100), anyOf[ minTotalClasses(10000), signOff ] ]. The anyOf is satisfied
    // via the sign-off, so its unmet minTotalClasses(10000) leaf must NOT count toward "how close" —
    // the only real blocker is minTotalClasses(100) at 95/100 = 0.95 → 'close', not 'notYet'.
    const sys = ladder({
      type: 'allOf',
      criteria: [
        { type: 'minTotalClasses', enforcement: 'required', count: 100 },
        {
          type: 'anyOf',
          criteria: [
            { type: 'minTotalClasses', enforcement: 'required', count: 10000 },
            { type: 'manualInstructorSignOff', enforcement: 'required' },
          ],
        },
      ],
    });
    const step = nextB(sys, {
      totalAttendance: 95,
      manualSignOffs: [
        { stepId: brand<StepId>('b'), byRole: 'instructor', at: instant(0), signerId: 'u' },
      ],
    });
    expect(step.status).toBe('close');
    expect(step.unmetRequired).toEqual(['minTotalClasses']);
  });

  it('a satisfied anyOf branch clears the other branch’s required leaf (ready)', () => {
    const sys = ladder({
      type: 'anyOf',
      criteria: [
        { type: 'minTotalClasses', enforcement: 'required', count: 10000 },
        { type: 'manualInstructorSignOff', enforcement: 'required' },
      ],
    });
    const step = nextB(sys, {
      manualSignOffs: [
        { stepId: brand<StepId>('b'), byRole: 'instructor', at: instant(0), signerId: 'u' },
      ],
    });
    expect(step.status).toBe('ready');
    expect(step.unmetRequired).toEqual([]);
  });
});

describe('validateConfig structural rules (audit fix + coverage)', () => {
  /** Build a candidate with two tracks and a cross-track prerequisite, expecting it to be rejected. */
  function crossTrackCandidate(): unknown {
    return {
      disciplineId: 'd',
      systemId: 's',
      presentation: 'belt',
      tracks: [{ id: 'kids' }, { id: 'adult' }],
      ladder: [
        {
          id: 'k0',
          kind: 'rank',
          order: 0,
          trackId: 'kids',
          visual: {},
          criteria: { type: 'allOf', criteria: [] },
        },
        {
          id: 'a0',
          kind: 'rank',
          order: 0,
          trackId: 'adult',
          visual: {},
          criteria: { type: 'allOf', criteria: [] },
        },
        {
          id: 'a1',
          kind: 'rank',
          order: 1,
          trackId: 'adult',
          visual: {},
          // Cross-track prerequisite: references a 'kids' step from an 'adult' step (unsatisfiable).
          criteria: { type: 'prerequisiteStep', enforcement: 'required', stepId: 'k0' },
        },
      ],
      transitions: [],
      curricula: [],
    };
  }

  it('rejects a cross-track prerequisiteStep (BAD_PREREQ)', () => {
    const res = validateConfig(crossTrackCandidate());
    expect(res.valid).toBe(false);
    expect(res.valid ? [] : res.errors.map((e) => e.code)).toContain('BAD_PREREQ');
  });

  it('flags an unknown prerequisite step (BAD_PREREQ)', () => {
    const res = validateConfig({
      disciplineId: 'd',
      systemId: 's',
      presentation: 'level',
      tracks: [{ id: 'adult' }],
      ladder: [
        {
          id: 'a',
          kind: 'level',
          order: 0,
          trackId: 'adult',
          visual: {},
          criteria: { type: 'allOf', criteria: [] },
        },
        {
          id: 'b',
          kind: 'level',
          order: 1,
          trackId: 'adult',
          visual: {},
          criteria: { type: 'prerequisiteStep', enforcement: 'required', stepId: 'does-not-exist' },
        },
      ],
      transitions: [],
      curricula: [],
    });
    expect(res.valid).toBe(false);
    expect(res.valid ? [] : res.errors.map((e) => e.code)).toContain('BAD_PREREQ');
  });
});
