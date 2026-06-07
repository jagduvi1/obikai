import type { AdapterContext } from '@obikai/adapter-contracts';
import { describe, expect, it } from 'vitest';
import { NoneVatProvider, type VatHttp, ViesVatProvider } from '../src/index.js';

const ctx: AdapterContext = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  clock: () => new Date('2026-06-07T10:00:00.000Z'),
  readSecret: () => Promise.resolve(''),
};

/** A fake HTTP that returns a fixed VIES JSON body (or throws / non-200). */
function http(body: unknown, opts: { ok?: boolean; throws?: boolean } = {}): VatHttp {
  return () => {
    if (opts.throws) return Promise.reject(new Error('network down'));
    return Promise.resolve({
      ok: opts.ok ?? true,
      status: opts.ok === false ? 503 : 200,
      json: () => Promise.resolve(body),
    });
  };
}

const vies = (h: VatHttp) => new ViesVatProvider({ baseUrl: 'https://vies.test/check' }, ctx, h);
const input = { countryCode: 'SE', number: '556677889901' };

describe('NoneVatProvider', () => {
  it('never checks the network — reports unavailable', async () => {
    const r = await new NoneVatProvider(ctx).check(input);
    expect(r.status).toBe('unavailable');
    expect(r.source).toBe('none');
  });
});

describe('ViesVatProvider status mapping', () => {
  it('valid:true → valid, with name/address cleaned and requestDate used', async () => {
    const r = await vies(
      http({
        valid: true,
        name: 'Aikido AB',
        address: 'Mästersamuelsgatan 1',
        requestIdentifier: 'WAPIAAA',
        requestDate: '2026-06-07T09:59:00.000Z',
      }),
    ).check(input);
    expect(r.status).toBe('valid');
    expect(r.name).toBe('Aikido AB');
    expect(r.requestIdentifier).toBe('WAPIAAA');
    expect(r.checkedAt).toBe('2026-06-07T09:59:00.000Z');
  });

  it("valid:true but member state hides details ('---') → null name/address", async () => {
    const r = await vies(http({ valid: true, name: '---', address: '' })).check(input);
    expect(r.status).toBe('valid');
    expect(r.name).toBeNull();
    expect(r.address).toBeNull();
  });

  it('valid:false + userError INVALID → invalid', async () => {
    const r = await vies(http({ valid: false, userError: 'INVALID' })).check(input);
    expect(r.status).toBe('invalid');
  });

  it('valid:false + MS_UNAVAILABLE → unavailable (NOT invalid)', async () => {
    const r = await vies(http({ valid: false, userError: 'MS_UNAVAILABLE' })).check(input);
    expect(r.status).toBe('unavailable');
  });

  it('rate-limit / blocked / unknown codes → unavailable', async () => {
    for (const code of [
      'SERVICE_UNAVAILABLE',
      'TIMEOUT',
      'GLOBAL_MAX_CONCURRENT_REQ',
      'VAT_BLOCKED',
      'WAT',
    ]) {
      const r = await vies(http({ valid: false, userError: code })).check(input);
      expect(r.status, code).toBe('unavailable');
    }
  });

  it('valid:false with no userError → unavailable (never assert invalid without proof)', async () => {
    const r = await vies(http({ valid: false })).check(input);
    expect(r.status).toBe('unavailable');
  });

  it('a non-200 response → unavailable', async () => {
    const r = await vies(http({}, { ok: false })).check(input);
    expect(r.status).toBe('unavailable');
  });

  it('a null / non-object body (200) → unavailable, not a crash', async () => {
    expect((await vies(http(null)).check(input)).status).toBe('unavailable');
    expect((await vies(http(undefined)).check(input)).status).toBe('unavailable');
    expect((await vies(http('oops')).check(input)).status).toBe('unavailable');
  });

  it('a network throw → unavailable (caught, not propagated)', async () => {
    const r = await vies(http({}, { throws: true })).check(input);
    expect(r.status).toBe('unavailable');
    expect(r.source).toBe('vies');
  });
});
