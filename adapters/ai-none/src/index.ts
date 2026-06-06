/**
 * @obikai/adapter-ai-none — the DEFAULT AiPort implementation (ADR-0005, invariant 4).
 * `NoopAiProvider` reports `isEnabled() === false`, advertises an empty capability set, and
 * throws `AiDisabledError` on `complete()`. This proves the product is fully functional with
 * AI OFF: callers that branch on `isEnabled()`/capabilities never reach an external sub-processor.
 * Depends only on @obikai/adapter-contracts + @obikai/domain — no vendor SDK, no network.
 */
import type {
  AdapterContext,
  AiCapability,
  AiPort,
  AiRequest,
  AiResult,
  HealthStatus,
  ProviderFactory,
  ResolvedAdapterConfig,
  Validator,
} from '@obikai/adapter-contracts';
import { AiDisabledError } from '@obikai/adapter-contracts';

/** No params: the disabled provider is configuration-free. */
export type NoneAiParams = Record<string, never>;

const paramsSchema: Validator<NoneAiParams> = {
  parse(): NoneAiParams {
    return {};
  },
};

export class NoopAiProvider implements AiPort {
  readonly kind = 'ai' as const;
  readonly providerId = 'none';
  readonly capabilities: ReadonlySet<AiCapability> = new Set<AiCapability>();

  async init(): Promise<void> {
    // Nothing to initialise — the provider holds no resources.
  }

  async dispose(): Promise<void> {
    // Nothing to release.
  }

  async health(): Promise<HealthStatus> {
    return { ok: true, detail: 'ai disabled' };
  }

  isEnabled(): boolean {
    return false;
  }

  async complete(_req: AiRequest): Promise<AiResult> {
    throw new AiDisabledError();
  }
}

export const NoopAiProviderFactory: ProviderFactory<NoopAiProvider, NoneAiParams> = {
  kind: 'ai',
  providerId: 'none',
  paramsSchema,
  create(_cfg: ResolvedAdapterConfig<NoneAiParams>, _ctx: AdapterContext): NoopAiProvider {
    return new NoopAiProvider();
  },
};
