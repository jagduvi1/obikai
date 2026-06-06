import type {
  AiProviderId,
  AuthProviderId,
  EmailProviderId,
  PaymentProviderId,
  StorageProviderId,
} from '@obikai/config';

/**
 * Public, unauthenticated snapshot of what THIS deployment can actually do, derived purely from
 * the resolved config. SPAs read it at load to hide controls a deployment can't honour — no dead
 * Stripe/SMS/AI buttons in a cash-only, AI-off self-host (ADR-0009).
 */
export interface CapabilitiesResponse {
  readonly paymentsProvider: PaymentProviderId;
  readonly storageProvider: StorageProviderId;
  readonly emailProvider: EmailProviderId;
  readonly authProvider: AuthProviderId;
  readonly aiProvider: AiProviderId;
  /** False when the AI provider is `none`. */
  readonly aiEnabled: boolean;
  /** False when the SMS provider is `disabled`. */
  readonly smsEnabled: boolean;
}
