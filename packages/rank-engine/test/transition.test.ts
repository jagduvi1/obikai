import { type StepId, type TrackId, brand } from '@obikai/domain';
import { describe, expect, it } from 'vitest';
import type { EvaluationContext, ProgressionSystemVersion } from '../src/index.js';
import { mintVersion, validateConfig } from '../src/index.js';
import { resolveTransition } from '../src/transition.js';
import { instant, makeInput } from './builders.js';

/**
 * Covers `resolveTransition` — the youth→adult crossing, which is exported public API the engine
 * relies on but had zero tests. It must: require a DOB, respect the age threshold, pick the HIGHEST
 * threshold reached, map the current step when a mapping exists (else apply the track move only), and
 * never fire for a different from-track.
 */
const step = (id: string, order: number, trackId: string) => ({
  id,
  kind: 'rank' as const,
  order,
  trackId,
  visual: {},
  criteria: { type: 'allOf' as const, criteria: [] },
});

function youthAdultVersion(): ProgressionSystemVersion {
  const res = validateConfig({
    disciplineId: 'd',
    systemId: 's',
    presentation: 'belt',
    tracks: [{ id: 'youth' }, { id: 'adult' }],
    ladder: [
      step('y-white', 0, 'youth'),
      step('y-yellow', 10, 'youth'),
      step('a-white', 0, 'adult'),
      step('a-blue', 10, 'adult'),
    ],
    transitions: [
      {
        fromTrackId: 'youth',
        toTrackId: 'adult',
        atAgeYears: 16,
        mapping: [{ fromStepId: 'y-yellow', toStepId: 'a-white' }],
      },
      {
        fromTrackId: 'youth',
        toTrackId: 'adult',
        atAgeYears: 18,
        mapping: [{ fromStepId: 'y-yellow', toStepId: 'a-blue' }],
      },
    ],
    curricula: [],
  });
  if (!res.valid) throw new Error(`fixture invalid: ${JSON.stringify(res.errors)}`);
  return mintVersion(null, res.draft);
}

const VERSION = youthAdultVersion();
const ctx = (epochMs: number): EvaluationContext => ({
  now: instant(epochMs),
  zone: 'Europe/Stockholm',
});
const NOW = Date.UTC(2026, 5, 1); // 2026-06-01
const youth = (over: { dob?: number; step?: string } = {}) =>
  makeInput({
    trackId: brand<TrackId>('youth'),
    currentStepId: brand<StepId>(over.step ?? 'y-yellow'),
    ...(over.dob !== undefined ? { dateOfBirth: instant(over.dob) } : {}),
  });

describe('resolveTransition', () => {
  it('does not apply without a date of birth', () => {
    expect(resolveTransition(VERSION, youth(), ctx(NOW)).applies).toBe(false);
  });

  it('does not apply below the lowest age threshold', () => {
    // born 2012 → age ~14 at NOW, below 16.
    expect(resolveTransition(VERSION, youth({ dob: Date.UTC(2012, 0, 1) }), ctx(NOW)).applies).toBe(
      false,
    );
  });

  it('applies the matched step mapping at the threshold', () => {
    // born 2009 → age 17 → ≥16, <18 → the 16 rule.
    const r = resolveTransition(VERSION, youth({ dob: Date.UTC(2009, 0, 1) }), ctx(NOW));
    expect(r.applies).toBe(true);
    expect(r.toTrackId).toBe('adult');
    expect(r.toStepId).toBe('a-white');
  });

  it('picks the HIGHEST age threshold reached', () => {
    // born 2007 → age 19 → ≥18 → the 18 rule maps to a-blue, not a-white.
    const r = resolveTransition(VERSION, youth({ dob: Date.UTC(2007, 0, 1) }), ctx(NOW));
    expect(r.applies).toBe(true);
    expect(r.toStepId).toBe('a-blue');
  });

  it('applies the track move but leaves toStepId unmapped when the current step has no mapping', () => {
    const r = resolveTransition(
      VERSION,
      youth({ dob: Date.UTC(2009, 0, 1), step: 'y-white' }),
      ctx(NOW),
    );
    expect(r.applies).toBe(true);
    expect(r.toTrackId).toBe('adult');
    expect(r.toStepId).toBeUndefined();
  });

  it('never fires for a different from-track', () => {
    const adult = makeInput({
      trackId: brand<TrackId>('adult'),
      dateOfBirth: instant(Date.UTC(2000, 0, 1)),
    });
    expect(resolveTransition(VERSION, adult, ctx(NOW)).applies).toBe(false);
  });
});
