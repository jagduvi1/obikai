/**
 * @obikai/rank-engine — a PURE, deterministic, framework/DB-agnostic rank/grading evaluator
 * (ADR-0005). Imports ONLY @obikai/domain (+ pure libs); never a DB, framework, or AI adapter, so
 * "AI never in the rank path" is a compile-time + dependency-graph guarantee. The entire public
 * surface is five pure functions plus types.
 */
export * from './types.js';
export { validateConfig } from './validate.js';
export { mintVersion } from './mint.js';
export { evaluateEligibility } from './evaluate.js';
export { promote, type AwardRequest } from './promote.js';
export { resolveTransition, type TransitionOutcome } from './transition.js';
export { contentHash, canonicalize, stableStringify } from './canonical.js';
