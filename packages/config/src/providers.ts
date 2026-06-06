import { z } from 'zod';

/** Provider-selection vocabularies (ADR-0003/0006/0009). Defaults are the self-hostable,
 * no-lock-in, AI-OFF choices. Each maps to an `adapters/*` implementation chosen at boot. */

export const PAYMENT_PROVIDERS = [
  'manual',
  'stub',
  'stripe',
  'swish',
  'autogiro',
  'vipps-mobilepay',
] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];

export const EMAIL_PROVIDERS = ['smtp', 'ses', 'postmark'] as const;
export type EmailProviderId = (typeof EMAIL_PROVIDERS)[number];

export const SMS_PROVIDERS = ['disabled', 'elks', 'twilio'] as const;
export type SmsProviderId = (typeof SMS_PROVIDERS)[number];

export const STORAGE_PROVIDERS = ['s3', 'fs'] as const;
export type StorageProviderId = (typeof STORAGE_PROVIDERS)[number];

export const AUTH_PROVIDERS = ['local', 'oidc'] as const;
export type AuthProviderId = (typeof AUTH_PROVIDERS)[number];

export const AI_PROVIDERS = ['none', 'ollama', 'anthropic', 'openai'] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

/** AI providers that run locally and therefore do NOT make member PII leave the operator's
 * infra. Used by the structural PII gate (ADR-0005): an external provider refuses PII tasks
 * unless a per-tenant DPA/consent flag is set. */
export const LOCAL_AI_PROVIDERS: ReadonlySet<AiProviderId> = new Set(['none', 'ollama']);

export const paymentProviderSchema = z.enum(PAYMENT_PROVIDERS);
export const emailProviderSchema = z.enum(EMAIL_PROVIDERS);
export const smsProviderSchema = z.enum(SMS_PROVIDERS);
export const storageProviderSchema = z.enum(STORAGE_PROVIDERS);
export const authProviderSchema = z.enum(AUTH_PROVIDERS);
export const aiProviderSchema = z.enum(AI_PROVIDERS);
