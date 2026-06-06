import type { Instant } from '@obikai/domain';

/**
 * Deterministic clock helpers (ADR-0001). Adapters and the rank engine read time ONLY through an
 * injected clock, never `Date.now()`. These give tests a frozen clock so payment/grading/date math
 * is reproducible across machines and runs.
 */

/**
 * A clock that always reports the same moment. Pass as `AdapterContext.clock` to freeze time in a
 * contract test: `clock: fixedClock(0)`.
 */
export function fixedClock(epochMs: number): () => Date {
  return () => new Date(epochMs);
}

/** The matching domain `Instant` for the same epoch, for pure rank-engine / date-math tests. */
export function instant(epochMs: number): Instant {
  return { epochMs };
}
