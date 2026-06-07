/**
 * @obikai/config — the single source of truth for deploy mode, tenancy, and which adapter
 * each provider port resolves to (ADR-0002/0009). Validated from env at boot with Zod.
 */
import type { z } from 'zod';
import type { DeployMode, Tenancy } from './deploy.js';
import { EnvSchema, type RawEnv } from './env.js';
import {
  type AiProviderId,
  type AuthProviderId,
  type EmailProviderId,
  LOCAL_AI_PROVIDERS,
  type PaymentProviderId,
  type SmsProviderId,
  type StorageProviderId,
} from './providers.js';

export * from './deploy.js';
export * from './providers.js';
export { EnvSchema, type RawEnv } from './env.js';

export interface AppConfig {
  readonly deployMode: DeployMode;
  readonly tenancy: Tenancy;
  readonly baseDomain: string;
  readonly selfHostTenantSlug: string | null;
  readonly trustProxyHops: number;
  readonly mongoUri: string;
  readonly redisUrl: string;
  readonly runWorkerInProcess: boolean;
  readonly dataMasterKey: string;
  readonly seedOnStart: boolean;
  readonly telemetryEnabled: boolean;
  readonly auth: {
    readonly provider: AuthProviderId;
    readonly jwtSecret: string;
    readonly accessTtl: string;
    readonly refreshTtl: string;
    readonly oidc: {
      readonly issuer: string;
      readonly clientId: string;
      readonly clientSecret: string | null;
    } | null;
  };
  readonly storage: {
    readonly provider: StorageProviderId;
    readonly s3: {
      readonly endpoint: string | null;
      readonly region: string;
      readonly bucket: string;
      readonly accessKeyId: string | null;
      readonly secretAccessKey: string | null;
      readonly forcePathStyle: boolean;
    };
    readonly fsRoot: string;
    /** Public origin the guarded `/files` route is served from (fs storage only); null otherwise. */
    readonly publicBaseUrl: string | null;
  };
  readonly email: {
    readonly provider: EmailProviderId;
    readonly from: string;
    readonly smtp: {
      readonly host: string | null;
      readonly port: number | null;
      readonly secure: boolean;
      readonly user: string | null;
      readonly pass: string | null;
    };
  };
  readonly sms: { readonly provider: SmsProviderId };
  readonly payments: {
    readonly provider: PaymentProviderId;
    readonly stripe: { readonly secretKey: string | null; readonly webhookSecret: string | null };
  };
  readonly ai: {
    readonly provider: AiProviderId;
    /** True for `none`/`ollama`: no member PII leaves operator infra (ADR-0005 PII gate). */
    readonly isLocal: boolean;
    readonly ollamaBaseUrl: string | null;
    readonly anthropicApiKey: string | null;
    readonly openaiApiKey: string | null;
  };
  readonly bootstrapOwner: { readonly email: string; readonly password: string } | null;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function toAppConfig(env: RawEnv): AppConfig {
  return {
    deployMode: env.DEPLOY_MODE,
    tenancy: env.TENANCY,
    baseDomain: env.BASE_DOMAIN,
    selfHostTenantSlug: env.SELF_HOST_TENANT_SLUG ?? null,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    mongoUri: env.MONGO_URI,
    redisUrl: env.REDIS_URL,
    runWorkerInProcess: env.RUN_WORKER_IN_PROCESS,
    dataMasterKey: env.DATA_MASTER_KEY,
    seedOnStart: env.SEED_ON_START,
    telemetryEnabled: env.TELEMETRY_ENABLED,
    auth: {
      provider: env.AUTH_PROVIDER,
      jwtSecret: env.AUTH_JWT_SECRET,
      accessTtl: env.ACCESS_TOKEN_TTL,
      refreshTtl: env.REFRESH_TOKEN_TTL,
      oidc:
        env.AUTH_PROVIDER === 'oidc' && env.OIDC_ISSUER && env.OIDC_CLIENT_ID
          ? {
              issuer: env.OIDC_ISSUER,
              clientId: env.OIDC_CLIENT_ID,
              clientSecret: env.OIDC_CLIENT_SECRET ?? null,
            }
          : null,
    },
    storage: {
      provider: env.STORAGE_PROVIDER,
      s3: {
        endpoint: env.S3_ENDPOINT ?? null,
        region: env.S3_REGION,
        bucket: env.S3_BUCKET,
        accessKeyId: env.S3_ACCESS_KEY_ID ?? null,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? null,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      },
      fsRoot: env.FS_STORAGE_ROOT,
      publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL ?? null,
    },
    email: {
      provider: env.EMAIL_PROVIDER,
      from: env.EMAIL_FROM,
      smtp: {
        host: env.SMTP_HOST ?? null,
        port: env.SMTP_PORT ?? null,
        secure: env.SMTP_SECURE,
        user: env.SMTP_USER ?? null,
        pass: env.SMTP_PASS ?? null,
      },
    },
    sms: { provider: env.SMS_PROVIDER },
    payments: {
      provider: env.PAYMENT_PROVIDER,
      stripe: {
        secretKey: env.STRIPE_SECRET_KEY ?? null,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? null,
      },
    },
    ai: {
      provider: env.AI_PROVIDER,
      isLocal: LOCAL_AI_PROVIDERS.has(env.AI_PROVIDER),
      ollamaBaseUrl: env.OLLAMA_BASE_URL ?? null,
      anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
      openaiApiKey: env.OPENAI_API_KEY ?? null,
    },
    bootstrapOwner:
      env.BOOTSTRAP_OWNER_EMAIL && env.BOOTSTRAP_OWNER_PASSWORD
        ? { email: env.BOOTSTRAP_OWNER_EMAIL, password: env.BOOTSTRAP_OWNER_PASSWORD }
        : null,
  };
}

/** Parse + validate the environment into a typed AppConfig. Throws ConfigError with a readable
 * message listing every problem. Call once at boot; never read process.env elsewhere. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid Obikai configuration:\n${issues}`);
  }
  return toAppConfig(parsed.data);
}

/** Like loadConfig but returns a Zod-style result instead of throwing — handy in tests. */
export function tryLoadConfig(env: NodeJS.ProcessEnv): z.SafeParseReturnType<unknown, AppConfig> {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) return parsed as z.SafeParseError<unknown>;
  return { success: true, data: toAppConfig(parsed.data) };
}
