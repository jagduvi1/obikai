import type { AdapterContext, SmsMessage } from '@obikai/adapter-contracts';
import { describe, expect, it } from 'vitest';
import { DisabledSmsProvider, DisabledSmsProviderFactory, SmsDisabledError } from './index.js';

const ctx: AdapterContext = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  async readSecret() {
    return '';
  },
  clock() {
    return new Date(0);
  },
};

const msg: SmsMessage = { to: '+46700000000', body: 'hello' };

describe('DisabledSmsProvider', () => {
  it('is disabled with an empty capability set', () => {
    const provider = new DisabledSmsProvider();
    expect(provider.kind).toBe('sms');
    expect(provider.providerId).toBe('disabled');
    expect(provider.capabilities.size).toBe(0);
  });

  it('reports healthy with detail "sms disabled"', async () => {
    const provider = new DisabledSmsProvider();
    await provider.init();
    await expect(provider.health()).resolves.toEqual({ ok: true, detail: 'sms disabled' });
    await provider.dispose();
  });

  it('rejects send() with a clear SmsDisabledError', async () => {
    const provider = new DisabledSmsProvider();
    await expect(provider.send(msg)).rejects.toBeInstanceOf(SmsDisabledError);
  });

  it('factory creates a DisabledSmsProvider and validates empty params', () => {
    expect(DisabledSmsProviderFactory.kind).toBe('sms');
    expect(DisabledSmsProviderFactory.providerId).toBe('disabled');
    expect(DisabledSmsProviderFactory.paramsSchema.parse({})).toEqual({});
    const provider = DisabledSmsProviderFactory.create(
      { kind: 'sms', providerId: 'disabled', tenantId: null, params: {}, secrets: {} },
      ctx,
    );
    expect(provider).toBeInstanceOf(DisabledSmsProvider);
  });
});
