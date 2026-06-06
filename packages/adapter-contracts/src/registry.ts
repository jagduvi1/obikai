import type { AiPort } from './ai.js';
import type { AuthPort } from './auth.js';
import type { Adapter, AdapterContext, AdapterKind, HealthStatus, SecretRef } from './base.js';
import type { EmailPort } from './email.js';
import type { PaymentsPort } from './payments.js';
import type { SmsPort } from './sms.js';
import type { StoragePort } from './storage.js';

/** Minimal validator shape — a Zod schema satisfies this, so adapters validate their params
 * without this contracts package taking a runtime dependency on zod. */
export interface Validator<P> {
  parse(input: unknown): P;
}

export interface ResolvedAdapterConfig<P = unknown> {
  readonly kind: AdapterKind;
  readonly providerId: string;
  /** null ⇒ the platform/self-host default; otherwise a per-tenant override (hosted plane). */
  readonly tenantId: string | null;
  /** Already-validated, non-secret params. */
  readonly params: P;
  /** Secret references resolved at use, never stored inline (ADR-0009). */
  readonly secrets: Readonly<Record<string, SecretRef>>;
}

export interface ProviderFactory<T extends Adapter, P = unknown> {
  readonly kind: AdapterKind;
  readonly providerId: string;
  readonly paramsSchema: Validator<P>;
  create(cfg: ResolvedAdapterConfig<P>, ctx: AdapterContext): T;
}

/** Chooses a provider per (kind, tenant): self-host = one env-derived config; hosted =
 * tenant-override-over-platform-default. Same registry both modes (ADR-0002/0009). */
export interface ConfigResolver {
  resolve(kind: AdapterKind, tenantId: string | null): Promise<ResolvedAdapterConfig>;
}

export interface AdapterRegistry {
  register<T extends Adapter, P>(factory: ProviderFactory<T, P>): void;
  /** Memoized per (kind, tenant). Throws a typed error if the provider is unknown or params invalid. */
  get<T extends Adapter>(kind: AdapterKind, tenantId: string | null): Promise<T>;
  healthAll(): Promise<Record<string, HealthStatus>>;
}

/** The fully-resolved set of ports for one tenant. `ai`/`sms` are optional in the TYPE — encoding
 * "fully functional with AI/SMS disabled" (invariants 3, 4) into the type system. */
export interface ProviderRegistry {
  readonly payments: PaymentsPort;
  readonly email: EmailPort;
  readonly storage: StoragePort;
  readonly auth: AuthPort;
  readonly sms?: SmsPort;
  readonly ai?: AiPort;
}

export class UnknownProviderError extends Error {
  constructor(kind: AdapterKind, providerId: string) {
    super(`No adapter registered for kind="${kind}" providerId="${providerId}"`);
    this.name = 'UnknownProviderError';
  }
}
