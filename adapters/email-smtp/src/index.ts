/**
 * @obikai/adapter-email-smtp — the DEFAULT EmailPort implementation (ADR-0003).
 * SMTP is the universal, self-hostable baseline: any operator can point it at their own mail
 * server with no vendor lock-in. Subject/html/text arrive already rendered by OUR i18n layer,
 * so no provider templating feature is depended on.
 *
 * Depends only on @obikai/adapter-contracts + @obikai/domain plus its own vendor SDK
 * (nodemailer). The nodemailer import lives ONLY here; vendor types are mapped to/from the port
 * DTOs and never re-exported.
 */
import type {
  AdapterContext,
  EmailCapability,
  EmailMessage,
  EmailPort,
  HealthStatus,
  ProviderFactory,
  ResolvedAdapterConfig,
  SecretRef,
  Validator,
} from '@obikai/adapter-contracts';
import nodemailer, { type SendMailOptions, type Transporter } from 'nodemailer';
import { z } from 'zod';

/** Resolved SMTP connection config handed to the provider at construction. Secrets (`user`,
 * `pass`) are `| null` for unauthenticated relays; the value is the already-read secret, never a
 * reference. */
export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string | null;
  readonly pass: string | null;
  /** RFC 5322 From header, e.g. `Obikai <no-reply@example.org>`. */
  readonly from: string;
}

/** Non-secret params validated by the factory before construction. `user`/`pass` are read from
 * `secrets` at init, never carried here. */
export interface SmtpParams {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly from: string;
}

const smtpParamsSchema: Validator<SmtpParams> = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  secure: z.boolean(),
  from: z.string().min(1),
});

/** Lazily fills `user`/`pass` from secret refs at init() — used only by the factory, since the
 * registry's `create` is synchronous but secret reads are async (ADR-0009). */
interface SecretLoader {
  load(): Promise<{ readonly user: string | null; readonly pass: string | null }>;
}

export class SmtpEmailProvider implements EmailPort {
  readonly kind = 'email' as const;
  readonly providerId = 'smtp';
  readonly capabilities: ReadonlySet<EmailCapability> = new Set<EmailCapability>(['send']);

  private config: SmtpConfig;
  private readonly secretLoader: SecretLoader | null;
  private transporter: Transporter | null = null;

  constructor(config: SmtpConfig, secretLoader: SecretLoader | null = null) {
    this.config = config;
    this.secretLoader = secretLoader;
  }

  async init(): Promise<void> {
    if (this.secretLoader) {
      const { user, pass } = await this.secretLoader.load();
      this.config = { ...this.config, user, pass };
    }
    const config = this.config;
    const auth =
      config.user !== null && config.pass !== null
        ? { auth: { user: config.user, pass: config.pass } }
        : {};
    // `auth` is spread in only when credentials are present (exactOptionalPropertyTypes: never
    // pass `undefined`). nodemailer infers the SMTP transport from this plain options object.
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...auth,
    });
  }

  async dispose(): Promise<void> {
    if (this.transporter) {
      this.transporter.close();
      this.transporter = null;
    }
  }

  async health(): Promise<HealthStatus> {
    const transporter = this.requireTransporter();
    try {
      await transporter.verify();
      return { ok: true, detail: `smtp ${this.config.host}:${this.config.port}` };
    } catch (cause) {
      return { ok: false, detail: errorMessage(cause) };
    }
  }

  async send(msg: EmailMessage): Promise<{ providerMessageId: string }> {
    const transporter = this.requireTransporter();
    const info = (await transporter.sendMail(this.toSendMailOptions(msg))) as {
      readonly messageId?: string;
    };
    return { providerMessageId: info.messageId ?? '' };
  }

  /** Map an EmailMessage port DTO to nodemailer's SendMailOptions. Optional fields are spread in
   * only when set, to satisfy exactOptionalPropertyTypes. */
  private toSendMailOptions(msg: EmailMessage): SendMailOptions {
    // nodemailer's `Address` requires both name+address; for nameless recipients pass the bare
    // email string form instead.
    const to: SendMailOptions['to'] = msg.to.map((recipient) =>
      recipient.name !== undefined
        ? { name: recipient.name, address: recipient.email }
        : recipient.email,
    );
    const replyTo = msg.replyTo !== undefined ? { replyTo: msg.replyTo } : {};
    return {
      from: this.config.from,
      to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...replyTo,
    };
  }

  private requireTransporter(): Transporter {
    if (!this.transporter) {
      throw new Error('SmtpEmailProvider used before init()');
    }
    return this.transporter;
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Reads the `user`/`pass` secret refs (if registered) via the adapter context at init time. */
function makeSecretLoader(
  secrets: Readonly<Record<string, SecretRef>>,
  ctx: AdapterContext,
): SecretLoader {
  return {
    async load() {
      const userRef = secrets.user;
      const passRef = secrets.pass;
      const user = userRef !== undefined ? await ctx.readSecret(userRef) : null;
      const pass = passRef !== undefined ? await ctx.readSecret(passRef) : null;
      return { user, pass };
    },
  };
}

/** Registry factory (ADR-0003). Validates non-secret params, then builds a provider that resolves
 * its SMTP credentials from the resolved secret refs during init(). */
export const SmtpEmailProviderFactory: ProviderFactory<SmtpEmailProvider, SmtpParams> = {
  kind: 'email',
  providerId: 'smtp',
  paramsSchema: smtpParamsSchema,
  create(cfg: ResolvedAdapterConfig<SmtpParams>, ctx: AdapterContext): SmtpEmailProvider {
    const config: SmtpConfig = {
      host: cfg.params.host,
      port: cfg.params.port,
      secure: cfg.params.secure,
      user: null,
      pass: null,
      from: cfg.params.from,
    };
    return new SmtpEmailProvider(config, makeSecretLoader(cfg.secrets, ctx));
  },
};
