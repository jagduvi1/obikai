/**
 * @obikai/adapter-sms-disabled — the DEFAULT SmsPort implementation (ADR-0003). SMS is OPTIONAL
 * and disable-able by design: `DisabledSmsProvider` advertises an empty capability set and rejects
 * `send()`, so the notification layer branches on capability (falling back to email/in-app) and
 * never on null. `health()` is OK because "disabled" is a valid steady state, not a failure.
 * Depends only on @obikai/adapter-contracts + @obikai/domain — no vendor SDK, no network.
 */
import type {
  AdapterContext,
  HealthStatus,
  ProviderFactory,
  ResolvedAdapterConfig,
  SmsCapability,
  SmsMessage,
  SmsPort,
  Validator,
} from '@obikai/adapter-contracts';

/** No params: the disabled provider is configuration-free. */
export type DisabledSmsParams = Record<string, never>;

const paramsSchema: Validator<DisabledSmsParams> = {
  parse(): DisabledSmsParams {
    return {};
  },
};

export class SmsDisabledError extends Error {
  constructor() {
    super('SMS is disabled (SMS_PROVIDER=disabled). Falling back to email/in-app delivery.');
    this.name = 'SmsDisabledError';
  }
}

export class DisabledSmsProvider implements SmsPort {
  readonly kind = 'sms' as const;
  readonly providerId = 'disabled';
  readonly capabilities: ReadonlySet<SmsCapability> = new Set<SmsCapability>();

  async init(): Promise<void> {
    // Nothing to initialise — the provider holds no resources.
  }

  async dispose(): Promise<void> {
    // Nothing to release.
  }

  async health(): Promise<HealthStatus> {
    return { ok: true, detail: 'sms disabled' };
  }

  async send(_msg: SmsMessage): Promise<{ providerMessageId: string }> {
    throw new SmsDisabledError();
  }
}

export const DisabledSmsProviderFactory: ProviderFactory<DisabledSmsProvider, DisabledSmsParams> = {
  kind: 'sms',
  providerId: 'disabled',
  paramsSchema,
  create(
    _cfg: ResolvedAdapterConfig<DisabledSmsParams>,
    _ctx: AdapterContext,
  ): DisabledSmsProvider {
    return new DisabledSmsProvider();
  },
};
