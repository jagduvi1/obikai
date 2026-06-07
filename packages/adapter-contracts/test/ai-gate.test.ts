import { describe, expect, it } from 'vitest';
import {
  type AiCapability,
  AiPersonalDataRefusedError,
  type AiPort,
  type AiRequest,
  type AiResult,
  withPersonalDataGate,
} from '../src/index.js';

/**
 * The structural PII gate (invariant 4): an EXTERNAL AI sub-processor must refuse personal data before
 * the provider is ever called, regardless of caller discipline. A local model passes through.
 */
class FakeAi implements AiPort {
  readonly kind = 'ai' as const;
  readonly providerId = 'fake';
  readonly capabilities = new Set<AiCapability>(['chat']);
  readonly calls: AiRequest[] = [];
  async init(): Promise<void> {}
  async dispose(): Promise<void> {}
  async health() {
    return { ok: true, detail: 'fake' };
  }
  isEnabled(): boolean {
    return true;
  }
  async complete(req: AiRequest): Promise<AiResult> {
    this.calls.push(req);
    return { text: 'ok', truncated: false };
  }
}

const req = (containsPersonalData: boolean): AiRequest => ({
  system: 's',
  user: 'u',
  maxTokens: 16,
  tenantId: 't1',
  containsPersonalData,
});

describe('withPersonalDataGate', () => {
  it('refuses personal data on an EXTERNAL provider — before the provider is called', async () => {
    const inner = new FakeAi();
    const gated = withPersonalDataGate(inner, { isLocal: false });
    await expect(gated.complete(req(true))).rejects.toBeInstanceOf(AiPersonalDataRefusedError);
    expect(inner.calls).toHaveLength(0); // never reached the sub-processor
  });

  it('passes non-personal requests through to an external provider', async () => {
    const inner = new FakeAi();
    const gated = withPersonalDataGate(inner, { isLocal: false });
    const res = await gated.complete(req(false));
    expect(res.text).toBe('ok');
    expect(inner.calls).toHaveLength(1);
  });

  it('does NOT gate a local model (not a sub-processor) — personal data is allowed', async () => {
    const inner = new FakeAi();
    const gated = withPersonalDataGate(inner, { isLocal: true });
    await expect(gated.complete(req(true))).resolves.toMatchObject({ text: 'ok' });
    expect(gated).toBe(inner); // pass-through, unwrapped
  });

  it('preserves the rest of the adapter surface', async () => {
    const gated = withPersonalDataGate(new FakeAi(), { isLocal: false });
    expect(gated.kind).toBe('ai');
    expect(gated.providerId).toBe('fake');
    expect(gated.isEnabled()).toBe(true);
    expect(await gated.health()).toEqual({ ok: true, detail: 'fake' });
  });
});
