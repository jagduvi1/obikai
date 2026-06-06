/**
 * @obikai/adapter-payments-manual — the self-host DEFAULT payments provider (ADR-0006). It models
 * cash / bank-transfer billing for a club that has contracted NO PSP. It pulls in NO vendor SDK
 * and depends only on `@obikai/adapter-contracts` + `@obikai/domain`.
 *
 * Lifecycle, by design:
 *   - `setupMandate()` returns an immediately-`active` mandate with `method: 'autogiro'`-style
 *     semantics expressed via the neutral `method` field — there is nothing for the payer's
 *     client to do, so the action is `{ type: 'none' }`. (We use the configured method verbatim;
 *     callers typically pass a manual/offline rail.)
 *   - `createCharge()` returns a charge in `'processing'` (an issued invoice awaiting an offline
 *     payment) with action `{ type: 'none' }`. No money moves automatically.
 *   - When staff confirm payment was received ("mark invoice paid"), the app calls
 *     {@link ManualPaymentsProvider.markPaid}. THIS IS THE KEY DESIGN POINT: it returns a
 *     `NormalizedWebhook` carrying the SAME canonical `charge.succeeded` PaymentEvent that a real
 *     PSP webhook would produce. The billing engine consumes that webhook through the identical
 *     code path it uses for Stripe/Swish/Autogiro — so the invoice/dunning lifecycle completes
 *     with NO PSP and no special-casing of "manual" anywhere downstream. State transitions still
 *     arrive only via a (synthetic but canonical) webhook, never trusted from the client.
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
  ResolvedAdapterConfig,
  SetupMandateInput,
  Validator,
} from '@obikai/adapter-contracts';
import type { Money } from '@obikai/domain';

/** Provider id surfaced to the registry and embedded in every Mandate/Charge this adapter mints. */
export const MANUAL_PROVIDER_ID = 'manual';

/** Manual billing needs no configuration; params are an empty object. */
export type ManualPaymentsParams = Record<string, never>;

/**
 * Capabilities the manual provider claims. It supports recurring mandates (a standing agreement
 * to invoice the member) and one-off invoices, but NOT refunds: a cash/bank-transfer refund is an
 * offline operation outside this adapter's scope.
 */
const MANUAL_CAPABILITIES: ReadonlySet<PaymentCapability> = new Set<PaymentCapability>([
  'one-off',
  'recurring-mandate',
]);

/** Minimal Validator (a Zod schema would also satisfy `Validator`); accepts only an empty object. */
const manualParamsSchema: Validator<ManualPaymentsParams> = {
  parse(input: unknown): ManualPaymentsParams {
    if (input !== undefined && input !== null && typeof input !== 'object') {
      throw new TypeError('manual payments params must be an object');
    }
    return {};
  },
};

/**
 * Cash / bank-transfer `PaymentsPort`. Mandates activate immediately; charges sit in
 * `'processing'` until staff confirm receipt via {@link markPaid}.
 */
export class ManualPaymentsProvider implements PaymentsPort {
  readonly kind = 'payments' as const;
  readonly providerId = MANUAL_PROVIDER_ID;
  readonly capabilities = MANUAL_CAPABILITIES;

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
    return { ok: true, detail: 'manual cash/bank-transfer billing (no PSP)' };
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
    if (!mandate) throw new Error(`ManualPaymentsProvider: unknown mandate "${id}"`);
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
      // Awaiting an offline payment that staff will confirm via markPaid().
      status: 'processing',
      idempotencyKey: input.idempotencyKey,
      createdAt: this.now(),
      ...(input.mandateId !== undefined ? { mandateId: input.mandateId } : {}),
      ...(input.invoiceId !== undefined ? { invoiceId: input.invoiceId } : {}),
    };
    this.charges.set(id, charge);
    return { charge, action: { type: 'none' } };
  }

  /**
   * Refunds are not supported by the manual provider — a cash/bank-transfer refund is an offline
   * action handled outside the system (and outside the `refund` capability this adapter omits).
   */
  async refund(_input: {
    chargeId: string;
    amount?: Money;
    idempotencyKey: string;
  }): Promise<Charge> {
    throw new Error(
      'ManualPaymentsProvider: refunds are offline operations and not supported by the manual provider',
    );
  }

  /**
   * Staff action: "mark invoice paid". Confirms an offline payment was received and returns the
   * canonical {@link NormalizedWebhook} that drives the billing lifecycle. The emitted event is a
   * `charge.succeeded` — byte-for-byte the SAME canonical PaymentEvent a real PSP webhook would
   * produce — so downstream apply-jobs need no manual-specific branch.
   *
   * @param chargeId the id of a charge previously returned by {@link createCharge}.
   * @param paidAmount optional override for the confirmed amount (e.g. partial cash). Defaults to
   *        the charge's full amount.
   */
  markPaid(chargeId: string, paidAmount?: Money): NormalizedWebhook {
    const existing = this.charges.get(chargeId);
    if (!existing) throw new Error(`ManualPaymentsProvider: unknown charge "${chargeId}"`);
    const succeeded: Charge = { ...existing, status: 'succeeded' };
    this.charges.set(existing.id, succeeded);
    return {
      providerId: this.providerId,
      // Manual billing has no PSP-connected account; the tenant is bound by the calling context.
      connectedAccountId: null,
      providerEventId: this.nextRef('evt'),
      event: {
        type: 'charge.succeeded',
        providerChargeRef: existing.providerChargeRef,
        amount: paidAmount ?? existing.amount,
      },
      receivedAt: this.now(),
    };
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
    return `${this.providerId}_${prefix}_${this.seq}`;
  }
}

/** Registry factory for the manual (cash/bank-transfer) provider (ADR-0003 uniform construction). */
export const manualPaymentsFactory: ProviderFactory<ManualPaymentsProvider, ManualPaymentsParams> =
  {
    kind: 'payments',
    providerId: MANUAL_PROVIDER_ID,
    paramsSchema: manualParamsSchema,
    create(
      _cfg: ResolvedAdapterConfig<ManualPaymentsParams>,
      ctx: AdapterContext,
    ): ManualPaymentsProvider {
      return new ManualPaymentsProvider(ctx);
    },
  };
