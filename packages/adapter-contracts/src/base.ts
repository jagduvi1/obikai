/**
 * The common contract every adapter implements (ADR-0003). One uniform shape for all six ports
 * lets the platform treat them identically for health checks, startup validation, and capability
 * gating. No vendor SDK type ever crosses these boundaries — implementations map to/from these
 * plain, serializable DTOs.
 */

export type AdapterKind = 'payments' | 'email' | 'sms' | 'storage' | 'auth' | 'ai' | 'vat';

/** Stable, opaque handle to WHERE a secret lives — never the secret value in a tenant document. */
export type SecretRef =
  | { readonly source: 'env'; readonly key: string }
  | { readonly source: 'vault'; readonly path: string };

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface HealthStatus {
  readonly ok: boolean;
  readonly detail?: string;
}

export interface Adapter<C extends string = string> {
  readonly kind: AdapterKind;
  /** e.g. 'smtp' | 'stripe' | 'manual' | 'ollama' | 'none'. */
  readonly providerId: string;
  /** Coarse feature flags the UI/engine gate on (e.g. a payment provider supporting recurring). */
  readonly capabilities: ReadonlySet<C>;
  init(): Promise<void>;
  dispose(): Promise<void>;
  health(): Promise<HealthStatus>;
}

/** Runtime context handed to an adapter at construction. */
export interface AdapterContext {
  readonly logger: Logger;
  readSecret(ref: SecretRef): Promise<string>;
  /** Injectable clock for deterministic tests (ADR-0001). */
  clock(): Date;
}
