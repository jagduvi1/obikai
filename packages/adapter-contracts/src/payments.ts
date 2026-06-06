import type { Money } from '@obikai/domain';
import type { Adapter } from './base.js';

/**
 * PaymentsPort — the load-bearing abstraction (ADR-0006, invariant 9). One `Mandate` + `Charge`
 * model hides the differences between cards/SEPA (Stripe), Autogiro mandates (BankID-signed),
 * Swish, and Vipps MobilePay. State transitions arrive ONLY via signature-verified webhooks;
 * the client is never trusted for payment state. `providerMandateRef`/`providerChargeRef` are
 * opaque strings (Stripe `pi_…`, a Bankgirot medgivande number, …) — never a vendor SDK object.
 */

export type PaymentCapability =
  | 'one-off'
  | 'recurring-mandate'
  | 'refund'
  | 'bankid-mandate'
  | 'app-switch'
  | 'sca-3ds'
  | 'connect-payouts';

export type MandateMethod = 'card' | 'sepa_debit' | 'autogiro' | 'swish' | 'vipps_mobilepay';
export type MandateStatus = 'pending' | 'active' | 'paused' | 'cancelled' | 'failed';
export type ChargeStatus = 'requires_action' | 'processing' | 'succeeded' | 'failed' | 'refunded';

/** What the CLIENT must do to finish setup/payment — provider-agnostic. */
export type PaymentAction =
  | { readonly type: 'none' }
  | { readonly type: 'redirect'; readonly url: string }
  | { readonly type: 'app_switch'; readonly url: string; readonly token?: string }
  | {
      readonly type: 'bankid_sign';
      readonly autostartToken?: string;
      readonly qrStartToken?: string;
    }
  | { readonly type: 'sca_3ds'; readonly clientSecretRef: string };

export interface Mandate {
  readonly id: string;
  readonly providerId: string;
  readonly providerMandateRef: string;
  readonly method: MandateMethod;
  readonly status: MandateStatus;
  readonly payerRef: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Charge {
  readonly id: string;
  readonly providerId: string;
  readonly providerChargeRef: string;
  readonly mandateId?: string;
  readonly amount: Money;
  readonly status: ChargeStatus;
  readonly idempotencyKey: string;
  readonly invoiceId?: string;
  readonly createdAt: string;
}

export interface SetupMandateInput {
  readonly method: MandateMethod;
  readonly payerRef: string;
  readonly tenantId: string;
  readonly returnUrl?: string;
  /** Only for BankID/Autogiro flows; minimized per GDPR and never logged. */
  readonly ssn?: string;
}

export interface CreateChargeInput {
  readonly amount: Money;
  readonly mandateId?: string;
  readonly oneOffMethod?: MandateMethod;
  readonly idempotencyKey: string;
  readonly invoiceId?: string;
  readonly returnUrl?: string;
}

export interface PaymentsPort extends Adapter<PaymentCapability> {
  readonly kind: 'payments';
  setupMandate(input: SetupMandateInput): Promise<{ mandate: Mandate; action: PaymentAction }>;
  getMandate(id: string): Promise<Mandate>;
  cancelMandate(id: string): Promise<Mandate>;
  createCharge(input: CreateChargeInput): Promise<{ charge: Charge; action: PaymentAction }>;
  refund(input: { chargeId: string; amount?: Money; idempotencyKey: string }): Promise<Charge>;
}

/** Canonical, vendor-neutral payment events. The billing state machine never sees a vendor payload. */
export type PaymentEvent =
  | { readonly type: 'mandate.activated'; readonly providerMandateRef: string }
  | {
      readonly type: 'mandate.failed';
      readonly providerMandateRef: string;
      readonly reason: string;
    }
  | { readonly type: 'mandate.cancelled'; readonly providerMandateRef: string }
  | {
      readonly type: 'charge.succeeded';
      readonly providerChargeRef: string;
      readonly amount: Money;
    }
  | { readonly type: 'charge.failed'; readonly providerChargeRef: string; readonly reason: string }
  | {
      readonly type: 'charge.refunded';
      readonly providerChargeRef: string;
      readonly amount: Money;
    };

export interface NormalizedWebhook {
  readonly providerId: string;
  /** Identifies the connected account / tenant a webhook belongs to (ADR-0006 tenant binding). */
  readonly connectedAccountId: string | null;
  /** Unique key for dedup; the event is dropped if seen before. */
  readonly providerEventId: string;
  readonly event: PaymentEvent;
  readonly receivedAt: string;
}

export interface RawWebhook {
  readonly rawBody: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

/** Verify the signature over the RAW bytes, THEN map to canonical events. Throws on bad signature. */
export interface WebhookGateway {
  verifyAndParse(raw: RawWebhook): Promise<NormalizedWebhook[]>;
}
