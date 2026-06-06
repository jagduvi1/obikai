/**
 * @obikai/gdpr — GDPR primitives (ADR-0007): consent records, an append-only hash-chained audit
 * log, a typed ROPA/retention registry that drives data export and right-to-erasure. Pure types +
 * orchestration interfaces; all persistence (repositories, keystores, identity map) is injected,
 * so this package has no DB coupling. Depends only on @obikai/domain, @obikai/adapter-contracts,
 * @noble/hashes and zod.
 */
export * from './consent.js';
export * from './audit.js';
export * from './ropa.js';
export * from './export.js';
export * from './erasure.js';
