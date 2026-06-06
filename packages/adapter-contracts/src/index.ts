/**
 * @obikai/adapter-contracts — the six provider port interfaces and nothing else (ADR-0003).
 * Zero vendor dependencies: depending on this package never pulls a vendor SDK into the tree.
 * Concrete implementations live in `adapters/*`; NestJS DI binds a port to one at boot.
 */
export * from './base.js';
export * from './payments.js';
export * from './email.js';
export * from './sms.js';
export * from './storage.js';
export * from './auth.js';
export * from './ai.js';
export * from './registry.js';
