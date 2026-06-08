import type {
  Adapter,
  AdapterKind,
  AiPort,
  AiRequest,
  AiResult,
  AuthPort,
  Charge,
  CreateChargeInput,
  EmailMessage,
  EmailPort,
  HealthStatus,
  Identity,
  Mandate,
  PaymentAction,
  PaymentsPort,
  PresignGetInput,
  PresignPutInput,
  RegisterPasswordInput,
  SetPasswordInput,
  SetupMandateInput,
  SmsMessage,
  SmsPort,
  StoragePort,
  VerifyPasswordInput,
} from '@obikai/adapter-contracts';
import { AiDisabledError } from '@obikai/adapter-contracts';
import type { Money } from '@obikai/domain';

/**
 * In-memory fakes implementing every port from @obikai/adapter-contracts. They exist to PROVE the
 * contracts are implementable and to back the conformance harness (`adapter-contract.ts`) and any
 * unit test that needs a port without a real vendor. Each implements the common `Adapter` base
 * (kind / providerId / capabilities / init / dispose / health). No vendor SDK is involved.
 */

/** Shared no-op lifecycle so each fake only declares the methods that carry test behaviour. */
abstract class FakeAdapterBase<C extends string> implements Adapter<C> {
  abstract readonly kind: AdapterKind;
  abstract readonly providerId: string;
  abstract readonly capabilities: ReadonlySet<C>;

  async init(): Promise<void> {
    // No external resource to acquire.
  }

  async dispose(): Promise<void> {
    // No external resource to release.
  }

  async health(): Promise<HealthStatus> {
    return { ok: true };
  }
}

/** A single recorded email send, so tests can assert recipients/subject without a mail server. */
export interface SentEmail {
  readonly message: EmailMessage;
  readonly providerMessageId: string;
}

/** EmailPort fake — records every send in `sent` and returns a deterministic message id. */
export class FakeEmailProvider
  extends FakeAdapterBase<'send' | 'batch' | 'inbound'>
  implements EmailPort
{
  readonly kind = 'email' as const;
  readonly providerId = 'fake';
  readonly capabilities: ReadonlySet<'send' | 'batch' | 'inbound'> = new Set(['send']);

  readonly sent: SentEmail[] = [];
  private seq = 0;

  async send(msg: EmailMessage): Promise<{ providerMessageId: string }> {
    const providerMessageId = `fake-email-${++this.seq}`;
    this.sent.push({ message: msg, providerMessageId });
    return { providerMessageId };
  }
}

/** StoragePort fake — keeps bytes in a Map and hands back fake presigned URLs (no network). */
export class FakeStorageProvider
  extends FakeAdapterBase<'presign-put' | 'presign-get' | 'delete' | 'list'>
  implements StoragePort
{
  readonly kind = 'storage' as const;
  readonly providerId = 'fake';
  readonly capabilities: ReadonlySet<'presign-put' | 'presign-get' | 'delete' | 'list'> = new Set([
    'presign-put',
    'presign-get',
    'delete',
  ]);

  /** Object store: key → recorded content type, mirroring what an uploaded object would carry. */
  readonly objects = new Map<string, { contentType: string }>();

  async presignPut(
    input: PresignPutInput,
  ): Promise<{ url: string; headers?: Record<string, string> }> {
    this.objects.set(input.key, { contentType: input.contentType });
    return {
      url: `https://fake-storage.local/put/${encodeURIComponent(input.key)}`,
      headers: { 'content-type': input.contentType },
    };
  }

  async presignGet(input: PresignGetInput): Promise<{ url: string }> {
    return { url: `https://fake-storage.local/get/${encodeURIComponent(input.key)}` };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

/** SmsPort fake mirroring the default `disabled` provider: empty capability set, rejects sends. */
export class NoopSmsProvider
  extends FakeAdapterBase<'send' | 'unicode' | 'sender-id'>
  implements SmsPort
{
  readonly kind = 'sms' as const;
  readonly providerId = 'disabled';
  readonly capabilities: ReadonlySet<'send' | 'unicode' | 'sender-id'> = new Set();

  async send(_msg: SmsMessage): Promise<{ providerMessageId: string }> {
    throw new Error(
      'SMS is disabled (SMS_PROVIDER=disabled). Notifications fall back to email/in-app.',
    );
  }
}

/** AiPort fake mirroring the default `none` provider: disabled and structurally inert. */
export class NoopAiProvider
  extends FakeAdapterBase<'chat' | 'json' | 'stream' | 'local'>
  implements AiPort
{
  readonly kind = 'ai' as const;
  readonly providerId = 'none';
  readonly capabilities: ReadonlySet<'chat' | 'json' | 'stream' | 'local'> = new Set();

  isEnabled(): boolean {
    return false;
  }

  async complete(_req: AiRequest): Promise<AiResult> {
    throw new AiDisabledError();
  }
}

/** PaymentsPort stub — in-memory mandates/charges, no vendor calls. Mandates start `active` and
 * charges `succeeded`, the happy-path needed by billing tests; webhooks are out of scope here. */
export class StubPaymentsProvider
  extends FakeAdapterBase<
    | 'one-off'
    | 'recurring-mandate'
    | 'refund'
    | 'bankid-mandate'
    | 'app-switch'
    | 'sca-3ds'
    | 'connect-payouts'
  >
  implements PaymentsPort
{
  readonly kind = 'payments' as const;
  readonly providerId = 'stub';
  readonly capabilities: ReadonlySet<
    | 'one-off'
    | 'recurring-mandate'
    | 'refund'
    | 'bankid-mandate'
    | 'app-switch'
    | 'sca-3ds'
    | 'connect-payouts'
  > = new Set(['one-off', 'recurring-mandate', 'refund']);

  readonly mandates = new Map<string, Mandate>();
  readonly charges = new Map<string, Charge>();
  private mandateSeq = 0;
  private chargeSeq = 0;
  /** Maps an idempotency key to the charge id it produced, so retries return the same charge. */
  private readonly chargesByIdempotency = new Map<string, string>();

  constructor(private readonly now: () => Date = () => new Date(0)) {
    super();
  }

  async setupMandate(
    input: SetupMandateInput,
  ): Promise<{ mandate: Mandate; action: PaymentAction }> {
    const id = `stub-mandate-${++this.mandateSeq}`;
    const ts = this.now().toISOString();
    const mandate: Mandate = {
      id,
      providerId: this.providerId,
      providerMandateRef: `ref-${id}`,
      method: input.method,
      status: 'active',
      payerRef: input.payerRef,
      createdAt: ts,
      updatedAt: ts,
    };
    this.mandates.set(id, mandate);
    return { mandate, action: { type: 'none' } };
  }

  async getMandate(id: string): Promise<Mandate> {
    const mandate = this.mandates.get(id);
    if (!mandate) throw new Error(`Unknown mandate: ${id}`);
    return mandate;
  }

  async cancelMandate(id: string): Promise<Mandate> {
    const existing = await this.getMandate(id);
    const cancelled: Mandate = {
      ...existing,
      status: 'cancelled',
      updatedAt: this.now().toISOString(),
    };
    this.mandates.set(id, cancelled);
    return cancelled;
  }

  async createCharge(input: CreateChargeInput): Promise<{ charge: Charge; action: PaymentAction }> {
    const dupId = this.chargesByIdempotency.get(input.idempotencyKey);
    if (dupId) {
      const existing = this.charges.get(dupId);
      if (existing) return { charge: existing, action: { type: 'none' } };
    }
    const id = `stub-charge-${++this.chargeSeq}`;
    const charge: Charge = {
      id,
      providerId: this.providerId,
      providerChargeRef: `ref-${id}`,
      ...(input.mandateId !== undefined ? { mandateId: input.mandateId } : {}),
      amount: input.amount,
      status: 'succeeded',
      idempotencyKey: input.idempotencyKey,
      ...(input.invoiceId !== undefined ? { invoiceId: input.invoiceId } : {}),
      createdAt: this.now().toISOString(),
    };
    this.charges.set(id, charge);
    this.chargesByIdempotency.set(input.idempotencyKey, id);
    return { charge, action: { type: 'none' } };
  }

  async refund(input: {
    chargeId: string;
    amount?: Money;
    idempotencyKey: string;
  }): Promise<Charge> {
    const existing = this.charges.get(input.chargeId);
    if (!existing) throw new Error(`Unknown charge: ${input.chargeId}`);
    const refunded: Charge = { ...existing, status: 'refunded' };
    this.charges.set(existing.id, refunded);
    return refunded;
  }
}

/** AuthPort fake — argon2id-free, in-memory email→password store. Identities are tenant-global. */
export class FakeAuthProvider
  extends FakeAdapterBase<'password' | 'mfa-totp' | 'oidc'>
  implements AuthPort
{
  readonly kind = 'auth' as const;
  readonly providerId = 'fake';
  readonly capabilities: ReadonlySet<'password' | 'mfa-totp' | 'oidc'> = new Set(['password']);

  /** email (lowercased) → plaintext password. Plaintext is acceptable ONLY in this test fake. */
  private readonly users = new Map<string, string>();

  private identity(email: string): Identity {
    return {
      subject: `fake-user-${email}`,
      email,
      emailVerified: true,
      provider: 'local',
      tenantScoped: false,
    };
  }

  async registerPassword(input: RegisterPasswordInput): Promise<Identity> {
    const key = input.email.toLowerCase();
    if (this.users.has(key)) throw new Error(`Already registered: ${input.email}`);
    this.users.set(key, input.password);
    return this.identity(input.email);
  }

  async verifyPassword(input: VerifyPasswordInput): Promise<Identity | null> {
    const stored = this.users.get(input.email.toLowerCase());
    if (stored === undefined || stored !== input.password) return null;
    return this.identity(input.email);
  }

  async setPassword(input: SetPasswordInput): Promise<boolean> {
    for (const email of this.users.keys()) {
      if (this.identity(email).subject === input.subject) {
        this.users.set(email, input.password);
        return true;
      }
    }
    return false;
  }
}
