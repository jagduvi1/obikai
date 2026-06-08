import { z } from 'zod';
import { deployModeSchema, tenancySchema } from './deploy.js';
import {
  aiProviderSchema,
  authProviderSchema,
  emailProviderSchema,
  paymentProviderSchema,
  smsProviderSchema,
  storageProviderSchema,
  vatValidationProviderSchema,
} from './providers.js';
import { isEuDataResidencyRegion } from './residency.js';

/** process.env values are strings; accept "true"/"1" as truthy. */
const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

/**
 * Reject obvious placeholder/example secrets so a deployment can't accidentally ship the value from
 * `.env.example` — a publicly-known signing key would be a cross-tenant account-takeover (audit E4).
 * Real random secrets (e.g. `openssl rand -hex 32`) never match these dictionary patterns.
 */
const PLACEHOLDER_SECRET = /change.?me|replace.?me|your.?(secret|key)|placeholder|example|^$/i;
const looksLikePlaceholder = (s: string): boolean => PLACEHOLDER_SECRET.test(s);

/** True if a connection URI carries userinfo (credentials) in its authority, e.g. `scheme://user:pass@host`.
 *  Used to reject an unauthenticated Mongo/Redis URI in hosted mode (G2). */
function hasUriCredentials(uri: string): boolean {
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(uri)?.[1];
  return authority?.includes('@') ?? false;
}

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
    // Product/platform display name used in account-level emails (e.g. password reset) where there is
    // no single dojo. Public, non-secret.
    APP_NAME: z.string().min(1).default('Obikai'),
    // Externally-reachable origin of the member/admin SPA, used to build deep links in account emails
    // (e.g. the password-reset link `${APP_PUBLIC_URL}/reset-password?token=…`). When unset, emails
    // fall back to showing the raw token.
    APP_PUBLIC_URL: z.string().url().optional(),

    MONGO_URI: z.string().min(1),
    REDIS_URL: z.string().min(1),
    // The background worker runs as its OWN process/container (started by `docker compose up`).
    // Hosting it inside the api process is not yet implemented, so this defaults false; do not rely
    // on it to run jobs in the api. (Reserved for a future in-process self-host mode — ADR-0017.)
    RUN_WORKER_IN_PROCESS: boolish.default(false),

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
    // Audited escape hatch: allow a non-EU/EEA storage region in HOSTED mode (Arts. 44–49). Off by
    // default so a hosted deployment cannot SILENTLY place member data outside the EU.
    ALLOW_NON_EU_RESIDENCY: boolish.default(false),
    FS_STORAGE_ROOT: z.string().default('/data/storage'),
    // Externally-reachable origin the guarded `/files` route is served from (fs storage only).
    STORAGE_PUBLIC_BASE_URL: z.string().url().optional(),

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

    VAT_VALIDATION_PROVIDER: vatValidationProviderSchema.default('none'),
    VIES_BASE_URL: z.string().url().optional(),

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
    // Refuse to boot with a placeholder/example secret (a publicly-known key = account takeover).
    require(!looksLikePlaceholder(
      env.AUTH_JWT_SECRET,
    ), 'AUTH_JWT_SECRET', 'looks like a placeholder — set a real random secret (`openssl rand -hex 32`)');
    require(!looksLikePlaceholder(
      env.DATA_MASTER_KEY,
    ), 'DATA_MASTER_KEY', 'looks like a placeholder — set a real random key (`openssl rand -hex 32`)');
    // Datastore auth (G2): a hosted deployment must never reach an unauthenticated Mongo/Redis. The
    // self-host compose enforces auth at the container; this catches a hosted URI that forgot to embed
    // credentials. Self-host is exempt (the operator owns their datastore's network isolation/auth).
    if (env.DEPLOY_MODE === 'hosted') {
      require(hasUriCredentials(
        env.MONGO_URI,
      ), 'MONGO_URI', 'hosted deployments must use an authenticated MongoDB connection (embed credentials, e.g. mongodb://user:pass@host/db?authSource=admin)');
      require(hasUriCredentials(
        env.REDIS_URL,
      ), 'REDIS_URL', 'hosted deployments must use a password-protected Redis connection (embed the password, e.g. redis://:pass@host:6379)');
    }
    if (env.STORAGE_PROVIDER === 's3') {
      require(Boolean(env.S3_ENDPOINT), 'S3_ENDPOINT', 'required when STORAGE_PROVIDER=s3');
      // EU data residency (Arts. 44–49): the hosted managed service must keep member data in the
      // EU/EEA. The region string is authoritative for a real AWS-backed deploy; self-host is exempt
      // (the operator controls physical location and S3-compatible region strings are arbitrary).
      if (env.DEPLOY_MODE === 'hosted' && !env.ALLOW_NON_EU_RESIDENCY) {
        require(isEuDataResidencyRegion(
          env.S3_REGION,
        ), 'S3_REGION', `hosted deployments must use an EU/EEA region for data residency (got "${env.S3_REGION}"); set ALLOW_NON_EU_RESIDENCY=true to override (audited)`);
      }
    }
    if (env.STORAGE_PROVIDER === 'fs') {
      // fs presigns URLs to the app's own `/files` route, so it must know its public origin.
      require(Boolean(
        env.STORAGE_PUBLIC_BASE_URL,
      ), 'STORAGE_PUBLIC_BASE_URL', 'required when STORAGE_PROVIDER=fs');
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
