import { z } from 'zod';
import { deployModeSchema, tenancySchema } from './deploy.js';
import {
  aiProviderSchema,
  authProviderSchema,
  emailProviderSchema,
  paymentProviderSchema,
  smsProviderSchema,
  storageProviderSchema,
} from './providers.js';

/** process.env values are strings; accept "true"/"1" as truthy. */
const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

/**
 * The raw environment schema — mirrors `.env.example`. Validated once at boot (ADR-0009);
 * defaults are the self-hostable, no-lock-in, AI-OFF choices. Cross-field rules (e.g. "S3
 * needs an endpoint", "OIDC needs an issuer") are enforced in `superRefine` so a misconfigured
 * deployment fails fast with a readable error rather than at first use.
 */
export const EnvSchema = z
  .object({
    DEPLOY_MODE: deployModeSchema.default('self-host'),
    TENANCY: tenancySchema.default('single'),
    BASE_DOMAIN: z.string().min(1).default('localhost'),
    SELF_HOST_TENANT_SLUG: z.string().min(1).optional(),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),

    MONGO_URI: z.string().min(1),
    REDIS_URL: z.string().min(1),
    RUN_WORKER_IN_PROCESS: boolish.default(true),

    AUTH_JWT_SECRET: z
      .string()
      .min(
        32,
        'AUTH_JWT_SECRET must be at least 32 chars (HS256 key strength); use `openssl rand -hex 32`',
      ),
    DATA_MASTER_KEY: z.string().min(16, 'DATA_MASTER_KEY must be at least 16 chars'),

    STORAGE_PROVIDER: storageProviderSchema.default('s3'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('eu-north-1'),
    S3_BUCKET: z.string().default('obikai'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: boolish.default(true),
    FS_STORAGE_ROOT: z.string().default('/data/storage'),

    EMAIL_PROVIDER: emailProviderSchema.default('smtp'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_SECURE: boolish.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    EMAIL_FROM: z.string().default('Obikai <no-reply@localhost>'),

    SMS_PROVIDER: smsProviderSchema.default('disabled'),

    AUTH_PROVIDER: authProviderSchema.default('local'),
    ACCESS_TOKEN_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL: z.string().default('7d'),
    OIDC_ISSUER: z.string().optional(),
    OIDC_CLIENT_ID: z.string().optional(),
    OIDC_CLIENT_SECRET: z.string().optional(),

    PAYMENT_PROVIDER: paymentProviderSchema.default('manual'),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    AI_PROVIDER: aiProviderSchema.default('none'),
    OLLAMA_BASE_URL: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),

    SEED_ON_START: boolish.default(false),
    BOOTSTRAP_OWNER_EMAIL: z.string().email().optional(),
    BOOTSTRAP_OWNER_PASSWORD: z.string().min(12).optional(),

    TELEMETRY_ENABLED: boolish.default(false),
  })
  .superRefine((env, ctx) => {
    const require = (cond: boolean, path: string, message: string) => {
      if (!cond) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };
    if (env.DEPLOY_MODE === 'self-host' && env.TENANCY === 'single') {
      require(Boolean(
        env.SELF_HOST_TENANT_SLUG,
      ), 'SELF_HOST_TENANT_SLUG', 'required for single-tenant self-host');
    }
    if (env.STORAGE_PROVIDER === 's3') {
      require(Boolean(env.S3_ENDPOINT), 'S3_ENDPOINT', 'required when STORAGE_PROVIDER=s3');
    }
    if (env.EMAIL_PROVIDER === 'smtp') {
      require(Boolean(env.SMTP_HOST), 'SMTP_HOST', 'required when EMAIL_PROVIDER=smtp');
    }
    if (env.AUTH_PROVIDER === 'oidc') {
      require(Boolean(env.OIDC_ISSUER), 'OIDC_ISSUER', 'required when AUTH_PROVIDER=oidc');
      require(Boolean(env.OIDC_CLIENT_ID), 'OIDC_CLIENT_ID', 'required when AUTH_PROVIDER=oidc');
    }
    if (env.PAYMENT_PROVIDER === 'stripe') {
      require(Boolean(
        env.STRIPE_SECRET_KEY,
      ), 'STRIPE_SECRET_KEY', 'required when PAYMENT_PROVIDER=stripe');
    }
    if (env.AI_PROVIDER === 'anthropic') {
      require(Boolean(
        env.ANTHROPIC_API_KEY,
      ), 'ANTHROPIC_API_KEY', 'required when AI_PROVIDER=anthropic');
    }
    if (env.AI_PROVIDER === 'openai') {
      require(Boolean(env.OPENAI_API_KEY), 'OPENAI_API_KEY', 'required when AI_PROVIDER=openai');
    }
  });

export type RawEnv = z.infer<typeof EnvSchema>;
