import type { AdapterContext } from '@obikai/adapter-contracts';
import { FsStorageProvider } from '@obikai/adapter-storage-fs';
import { describe, expect, it } from 'vitest';
import { authorizeFsRequest, contentTypeForKey, decodeKey } from './files.support.js';

const NOW_MS = 1_750_000_000_000;
const NOW_SEC = Math.floor(NOW_MS / 1000);
const SECRET = 'unit-test-signing-secret';

const ctx: AdapterContext = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  clock: () => new Date(NOW_MS),
  readSecret: () => Promise.resolve(''),
};
const provider = new FsStorageProvider(
  { root: '/tmp/obikai-files-test', publicBaseUrl: 'https://dojo.example', signingSecret: SECRET },
  ctx,
);

function queryFromUrl(url: string) {
  const u = new URL(url);
  return {
    op: u.searchParams.get('op') ?? undefined,
    exp: u.searchParams.get('exp') ?? undefined,
    sig: u.searchParams.get('sig') ?? undefined,
  };
}

describe('decodeKey', () => {
  it('strips the /files/ prefix and URL-decodes', () => {
    expect(decodeKey('/files/waivers/t1/x.pdf')).toBe('waivers/t1/x.pdf');
    expect(decodeKey('/files/a%20b.pdf')).toBe('a b.pdf');
  });
});

describe('contentTypeForKey', () => {
  it('maps known extensions and defaults to octet-stream', () => {
    expect(contentTypeForKey('a/b.pdf')).toBe('application/pdf');
    expect(contentTypeForKey('x.PNG')).toBe('image/png');
    expect(contentTypeForKey('x.jpeg')).toBe('image/jpeg');
    expect(contentTypeForKey('noext')).toBe('application/octet-stream');
  });
});

describe('authorizeFsRequest', () => {
  it('accepts a freshly-minted PUT token', async () => {
    const { url } = await provider.presignPut({
      key: 'waivers/t1/x.pdf',
      contentType: 'application/pdf',
    });
    const q = queryFromUrl(url);
    expect(authorizeFsRequest('put', 'waivers/t1/x.pdf', q, SECRET, NOW_SEC)).toBe(true);
  });

  it('accepts a freshly-minted GET token', async () => {
    const { url } = await provider.presignGet({ key: 'waivers/t1/x.pdf' });
    const q = queryFromUrl(url);
    expect(authorizeFsRequest('get', 'waivers/t1/x.pdf', q, SECRET, NOW_SEC)).toBe(true);
  });

  it('rejects an expired token', async () => {
    const { url } = await provider.presignPut({
      key: 'a.pdf',
      contentType: 'application/pdf',
      expiresSec: 60,
    });
    const q = queryFromUrl(url);
    expect(authorizeFsRequest('put', 'a.pdf', q, SECRET, NOW_SEC + 3600)).toBe(false);
  });

  it('rejects an op mismatch (a GET token used for a PUT)', async () => {
    const { url } = await provider.presignGet({ key: 'a.pdf' });
    const q = queryFromUrl(url);
    expect(authorizeFsRequest('put', 'a.pdf', q, SECRET, NOW_SEC)).toBe(false);
  });

  it('rejects a token for a different key (signature is bound to the key)', async () => {
    const { url } = await provider.presignGet({ key: 'a.pdf' });
    const q = queryFromUrl(url);
    expect(authorizeFsRequest('get', 'b.pdf', q, SECRET, NOW_SEC)).toBe(false);
  });

  it('rejects a tampered signature and a missing query', async () => {
    const { url } = await provider.presignGet({ key: 'a.pdf' });
    const q = queryFromUrl(url);
    expect(authorizeFsRequest('get', 'a.pdf', { ...q, sig: `${q.sig}00` }, SECRET, NOW_SEC)).toBe(
      false,
    );
    expect(authorizeFsRequest('get', 'a.pdf', {}, SECRET, NOW_SEC)).toBe(false);
  });
});
