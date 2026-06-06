import type { AdapterContext, AiRequest } from '@obikai/adapter-contracts';
import { AiDisabledError } from '@obikai/adapter-contracts';
import { describe, expect, it } from 'vitest';
import { NoopAiProvider, NoopAiProviderFactory } from './index.js';

const ctx: AdapterContext = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  async readSecret() {
    return '';
  },
  clock() {
    return new Date(0);
  },
};

const req: AiRequest = {
  system: 'you are a test',
  user: 'hello',
  maxTokens: 16,
  tenantId: 't_1',
  containsPersonalData: false,
};

describe('NoopAiProvider', () => {
  it('is disabled with an empty capability set', () => {
    const provider = new NoopAiProvider();
    expect(provider.kind).toBe('ai');
    expect(provider.providerId).toBe('none');
    expect(provider.isEnabled()).toBe(false);
    expect(provider.capabilities.size).toBe(0);
  });

  it('reports healthy (disabled is a valid steady state)', async () => {
    const provider = new NoopAiProvider();
    await provider.init();
    await expect(provider.health()).resolves.toEqual({ ok: true, detail: 'ai disabled' });
    await provider.dispose();
  });

  it('throws AiDisabledError on complete()', async () => {
    const provider = new NoopAiProvider();
    await expect(provider.complete(req)).rejects.toBeInstanceOf(AiDisabledError);
  });

  it('factory creates a NoopAiProvider and validates empty params', () => {
    expect(NoopAiProviderFactory.kind).toBe('ai');
    expect(NoopAiProviderFactory.providerId).toBe('none');
    expect(NoopAiProviderFactory.paramsSchema.parse({})).toEqual({});
    const provider = NoopAiProviderFactory.create(
      { kind: 'ai', providerId: 'none', tenantId: null, params: {}, secrets: {} },
      ctx,
    );
    expect(provider).toBeInstanceOf(NoopAiProvider);
  });
});
