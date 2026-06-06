import { type Instant, type StepId, type TrackId, brand } from '@obikai/domain';
import { mintVersion, validateConfig } from '../src/index.js';
import type { ProgressionSystemVersion, StudentProgressionInput } from '../src/index.js';

export const instant = (epochMs: number): Instant => ({ epochMs });
export const DAY = 86_400_000;
export const YEAR = 365 * DAY;

/** A small but realistic BJJ-style adult ladder: white → blue with composite criteria. */
export function sampleSystem(overrides?: {
  blueMonths?: number;
  blueClasses?: number;
}): ProgressionSystemVersion {
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
        visual: { primaryColor: '#ffffff' },
        criteria: { type: 'allOf', criteria: [] },
      },
      {
        id: 'blue',
        kind: 'rank',
        order: 10,
        trackId: 'adult',
        visual: { primaryColor: '#0000ff' },
        criteria: {
          type: 'allOf',
          criteria: [
            { type: 'minTimeAtStep', enforcement: 'required', months: overrides?.blueMonths ?? 12 },
            {
              type: 'minClassesSinceLastPromotion',
              enforcement: 'required',
              count: overrides?.blueClasses ?? 100,
            },
            { type: 'manualInstructorSignOff', enforcement: 'required' },
            { type: 'minAge', enforcement: 'advisory', years: 16 },
          ],
        },
      },
    ],
    transitions: [],
    curricula: [],
  };
  const res = validateConfig(candidate);
  if (!res.valid) throw new Error(`sample invalid: ${JSON.stringify(res.errors)}`);
  return mintVersion(null, res.draft);
}

/** A system whose only criterion (white→blue) is a required class count — for isolating one axis. */
export function classOnlySystem(count: number): ProgressionSystemVersion {
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
      {
        id: 'b',
        kind: 'level',
        order: 1,
        trackId: 'adult',
        visual: {},
        criteria: { type: 'minClassesSinceLastPromotion', enforcement: 'required', count },
      },
    ],
    transitions: [],
    curricula: [],
  };
  const res = validateConfig(candidate);
  if (!res.valid) throw new Error(`classOnly invalid: ${JSON.stringify(res.errors)}`);
  return mintVersion(null, res.draft);
}

export function makeInput(partial: Partial<StudentProgressionInput> = {}): StudentProgressionInput {
  return {
    systemVersionId: brand('v'),
    trackId: brand<TrackId>('adult'),
    currentStepId: brand<StepId>('white'),
    enteredCurrentStepAt: instant(0),
    attendanceSinceLastPromotion: 0,
    totalAttendance: 0,
    completedCurriculumItemIds: [],
    gradingResults: [],
    manualSignOffs: [],
    ...partial,
  };
}

export const STATUS_RANK: Record<string, number> = {
  notYet: 0,
  close: 1,
  ready: 2,
};
