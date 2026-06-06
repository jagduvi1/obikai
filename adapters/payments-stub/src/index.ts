/**
 * @obikai/adapter-payments-stub — a deterministic, in-memory sandbox implementation of
 * `PaymentsPort` (ADR-0006). It contracts NO PSP and pulls in NO vendor SDK: it is one of the
 * two self-hostable defaults (the other being `manual`). Every operation succeeds immediately
 * and deterministically so the billing engine, dunning, and UI flows can be exercised end-to-end
 * in development and tests without any external network or money movement.
 *
 * Because there is no real provider, there are no real webhooks: the exported `WebhookGateway`
 * verifies nothing and parses to an empty event list. State lives in memory for the lifetime of
 * the process and resets on `dispose()`.
 */
import type {
  AdapterContext,
  Charge,
  CreateChargeInput,
  HealthStatus,
  Mandate,
  NormalizedWebhook,
  PaymentAction,
  PaymentCapability,
  PaymentsPort,
  ProviderFactory,
  RawWebhook,
  ResolvedAdapterConfig,
  SetupMandateInput,
  Validator,
  WebhookGateway,
} from '@obikai/adapter-contracts';
import type { Money } from '@obikai/domain';

/** Provider id surfaced to the registry and embedded in every Mandate/Charge this adapter mints. */
export const STUB_PROVIDER_ID = 'stub';

/** This sandbox needs no configuration; params are an empty object. */
export type StubPaymentsParams = Record<string, never>;

/** The capabilities the stub claims — enough to drive one-off, recurring, and refund flows. */
const STUB_CAPABILITIES: ReadonlySet<PaymentCapability> = new Set<PaymentCapability>([
  'one-off',
  'recurring-mandate',
  'refund',
]);

/** Minimal Validator (a Zod schema would also satisfy `Validator`); accepts only an empty object. */
const stubParamsSchema: Validator<StubPaymentsParams> = {
  parse(input: unknown): StubPaymentsParams {
    if (input !== undefined && input !== null && typeof input !== 'object') {
      throw new TypeError('stub payments params must be an object');
    }
    return {};
  },
};

/**
 * Deterministic, in-memory `PaymentsPort`. Setup yields an immediately-active mandate, charges
 * succeed at once, refunds complete at once — all with `action {type:'none'}` since the client
 * never has to do anything in the sandbox.
 */
export class StubPaymentsProvider implements PaymentsPort {
  readonly kind = 'payments' as const;
  readonly providerId = STUB_PROVIDER_ID;
  readonly capabilities = STUB_CAPABILITIES;

  private readonly ctx: AdapterContext;
  private readonly mandates = new Map<string, Mandate>();
  private readonly charges = new Map<string, Charge>();
  private seq = 0;

  constructor(ctx: AdapterContext) {
    this.ctx = ctx;
  }

  async init(): Promise<void> {
    // No external resources to open.
  }

  async dispose(): Promise<void> {
    this.mandates.clear();
    this.charges.clear();
    this.seq = 0;
  }

  async health(): Promise<HealthStatus> {
    return { ok: true, detail: 'stub sandbox (in-memory, deterministic)' };
  }

  async setupMandate(
    input: SetupMandateInput,
  ): Promise<{ mandate: Mandate; action: PaymentAction }> {
    const now = this.now();
    const id = this.nextId('mandate');
    const mandate: Mandate = {
      id,
      providerId: this.providerId,
      providerMandateRef: this.nextRef('mref'),
      method: input.method,
      status: 'active',
      payerRef: input.payerRef,
      createdAt: now,
      updatedAt: now,
    };
    this.mandates.set(id, mandate);
    return { mandate, action: { type: 'none' } };
  }

  async getMandate(id: string): Promise<Mandate> {
    const mandate = this.mandates.get(id);
    if (!mandate) throw new Error(`StubPaymentsProvider: unknown mandate "${id}"`);
    return mandate;
  }

  async cancelMandate(id: string): Promise<Mandate> {
    const existing = await this.getMandate(id);
    const cancelled: Mandate = { ...existing, status: 'cancelled', updatedAt: this.now() };
    this.mandates.set(id, cancelled);
    return cancelled;
  }

  async createCharge(input: CreateChargeInput): Promise<{ charge: Charge; action: PaymentAction }> {
    const id = this.nextId('charge');
    const charge: Charge = {
      id,
      providerId: this.providerId,
      providerChargeRef: this.nextRef('cref'),
      amount: input.amount,
      status: 'succeeded',
      idempotencyKey: input.idempotencyKey,
      createdAt: this.now(),
      ...(input.mandateId !== undefined ? { mandateId: input.mandateId } : {}),
      ...(input.invoiceId !== undefined ? { invoiceId: input.invoiceId } : {}),
    };
    this.charges.set(id, charge);
    return { charge, action: { type: 'none' } };
  }

  async refund(input: {
    chargeId: string;
    amount?: Money;
    idempotencyKey: string;
  }): Promise<Charge> {
    const existing = this.charges.get(input.chargeId);
    if (!existing) throw new Error(`StubPaymentsProvider: unknown charge "${input.chargeId}"`);
    const refunded: Charge = { ...existing, status: 'refunded' };
    this.charges.set(existing.id, refunded);
    return refunded;
  }

  private now(): string {
    return this.ctx.clock().toISOString();
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${this.providerId}_${prefix}_${this.seq}`;
  }

  private nextRef(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }
}

/**
 * The stub has no real PSP, so it receives no real webhooks. This gateway therefore verifies
 * nothing and always parses to an empty list — sandbox state transitions happen synchronously
 * inside the provider methods instead.
 */
export class StubWebhookGateway implements WebhookGateway {
  async verifyAndParse(_raw: RawWebhook): Promise<NormalizedWebhook[]> {
    return [];
  }
}

/** Registry factory for the stub sandbox provider (ADR-0003 uniform construction). */
export const stubPaymentsFactory: ProviderFactory<StubPaymentsProvider, StubPaymentsParams> = {
  kind: 'payments',
  providerId: STUB_PROVIDER_ID,
  paramsSchema: stubParamsSchema,
  create(
    _cfg: ResolvedAdapterConfig<StubPaymentsParams>,
    ctx: AdapterContext,
  ): StubPaymentsProvider {
    return new StubPaymentsProvider(ctx);
  },
};
