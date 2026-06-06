/**
 * @obikai/test-utils — reusable test helpers shared across the stack: in-memory port fakes (which
 * prove the @obikai/adapter-contracts ports are implementable), a single adapter conformance
 * harness every real adapter is run against, and deterministic clock helpers (ADR-0001/0003).
 * Test-only: never imported by runtime code.
 */
export * from './fake-adapters.js';
export * from './adapter-contract.js';
export * from './clock.js';
