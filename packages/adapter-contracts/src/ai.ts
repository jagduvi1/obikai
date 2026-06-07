import type { Adapter } from './base.js';

/**
 * AiPort — a PURE convenience layer (ADR-0005, invariant 4). It exposes ONLY text/JSON
 * generation: it has no method that mutates state and is never injected into the rank engine,
 * so it is structurally incapable of auto-promoting. The default `NoopAiProvider` returns
 * `isEnabled() === false` and throws on use, proving the product is fully functional AI-OFF.
 *
 * `containsPersonalData` drives the STRUCTURAL PII gate: when true and the resolved provider is
 * an external (non-local) sub-processor, the implementation must refuse or route to a local
 * model unless a per-tenant DPA/consent flag is set — never a caller-discipline boolean alone.
 */
export type AiCapability = 'chat' | 'json' | 'stream' | 'local';

export interface AiRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
  readonly json?: boolean;
  readonly tenantId: string;
  readonly containsPersonalData: boolean;
}

export interface AiResult {
  readonly text: string;
  readonly truncated: boolean;
}

export class AiDisabledError extends Error {
  constructor() {
    super('AI is disabled (AI_PROVIDER=none). This feature is optional and not required.');
    this.name = 'AiDisabledError';
  }
}

export class AiPersonalDataRefusedError extends Error {
  constructor() {
    super(
      'Refusing to send personal data to an external AI sub-processor without a DPA/consent flag.',
    );
    this.name = 'AiPersonalDataRefusedError';
  }
}

export interface AiPort extends Adapter<AiCapability> {
  readonly kind: 'ai';
  isEnabled(): boolean;
  complete(req: AiRequest): Promise<AiResult>;
}

/**
 * The STRUCTURAL PII gate (invariant 4). Wrap any resolved {@link AiPort} with this at the composition
 * root: when the provider is an EXTERNAL sub-processor (`isLocal === false`), a request carrying
 * personal data is REFUSED ({@link AiPersonalDataRefusedError}) before the provider is ever called —
 * the guarantee can't depend on each caller remembering to check `containsPersonalData`. A local model
 * (`isLocal === true`, e.g. Ollama) is not a sub-processor, so the port passes through unwrapped.
 *
 * Methods are delegated explicitly (not spread/proxied) so a class-based adapter's private state and
 * `this` binding are preserved.
 */
export function withPersonalDataGate(port: AiPort, opts: { readonly isLocal: boolean }): AiPort {
  if (opts.isLocal) return port;
  return {
    kind: port.kind,
    providerId: port.providerId,
    capabilities: port.capabilities,
    init: () => port.init(),
    dispose: () => port.dispose(),
    health: () => port.health(),
    isEnabled: () => port.isEnabled(),
    complete: (req: AiRequest): Promise<AiResult> => {
      if (req.containsPersonalData) return Promise.reject(new AiPersonalDataRefusedError());
      return port.complete(req);
    },
  };
}
