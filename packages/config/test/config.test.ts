import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/index.js';

const base: Record<string, string> = {
  MONGO_URI: 'mongodb://localhost/obikai',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_JWT_SECRET: '0123456789abcdef0123456789abcdef',
  DATA_MASTER_KEY: '0123456789abcdef0123',
  SELF_HOST_TENANT_SLUG: 'mydojo',
  S3_ENDPOINT: 'http://localhost:9000',
  SMTP_HOST: 'localhost',
};

describe('loadConfig', () => {
  it('defaults to the self-hostable, AI-OFF, no-lock-in configuration', () => {
    const cfg = loadConfig(base);
    expect(cfg.deployMode).toBe('self-host');
    expect(cfg.tenancy).toBe('single');
    expect(cfg.ai.provider).toBe('none');
    expect(cfg.ai.isLocal).toBe(true);
    expect(cfg.payments.provider).toBe('manual');
    expect(cfg.email.provider).toBe('smtp');
    expect(cfg.storage.provider).toBe('s3');
    expect(cfg.sms.provider).toBe('disabled');
  });

  it('throws ConfigError on missing required values', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it('requires SELF_HOST_TENANT_SLUG for single-tenant self-host', () => {
    const withoutSlug: Record<string, string> = { ...base };
    withoutSlug.SELF_HOST_TENANT_SLUG = undefined;
    expect(() => loadConfig(withoutSlug)).toThrow(/SELF_HOST_TENANT_SLUG/);
  });

  it('marks an external AI provider as not local (PII gate input — ADR-0005)', () => {
    const cfg = loadConfig({ ...base, AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test' });
    expect(cfg.ai.provider).toBe('anthropic');
    expect(cfg.ai.isLocal).toBe(false);
  });

  it('does not require a tenant slug for multi-tenant', () => {
    const cfg = loadConfig({ ...base, TENANCY: 'multi', DEPLOY_MODE: 'hosted' });
    expect(cfg.tenancy).toBe('multi');
  });
});

describe('EU data-residency enforcement (hosted)', () => {
  const hosted: Record<string, string> = { ...base, DEPLOY_MODE: 'hosted', TENANCY: 'multi' };

  it('the default S3_REGION is an EU/EEA region (CI drift guard)', () => {
    // No region set → schema default must remain EU, so a hosted deploy is compliant out of the box.
    expect(() => loadConfig(hosted)).not.toThrow();
  });

  it('rejects a non-EU storage region in hosted mode', () => {
    expect(() => loadConfig({ ...hosted, S3_REGION: 'us-east-1' })).toThrow(/EU\/EEA region/);
  });

  it('allows a non-EU region only with the audited escape hatch', () => {
    expect(() =>
      loadConfig({ ...hosted, S3_REGION: 'us-east-1', ALLOW_NON_EU_RESIDENCY: 'true' }),
    ).not.toThrow();
  });

  it('does NOT constrain the region for self-host (operator controls physical location)', () => {
    // self-host with an arbitrary S3-compatible region (e.g. MinIO default) must be accepted.
    expect(() => loadConfig({ ...base, S3_REGION: 'us-east-1' })).not.toThrow();
  });
});
