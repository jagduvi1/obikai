/**
 * @obikai/adapter-auth-local — the default `AuthPort` (ADR-0004). Verifies identity via local
 * password only; sessions/JWT live in the app token service, never here. OIDC is a separate future
 * adapter. Depends ONLY on @obikai/adapter-contracts + @obikai/domain and Node built-ins
 * (`node:crypto`) — ZERO third-party runtime dependencies, no native build (ADR-0003).
 */
export { LocalAuthProvider } from './provider.js';
export { createLocalAuthFactory, type LocalAuthParams } from './factory.js';
export {
  EmailAlreadyRegisteredError,
  type IdentityStore,
  type NewCredential,
  type StoredCredential,
} from './store.js';
export { hashPassword, verifyPassword, DECOY_HASH } from './hash.js';
