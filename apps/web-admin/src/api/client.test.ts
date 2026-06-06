import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, login, setAccessToken, setOnAuthLost } from './client';

/** Build a Response-like object for the mocked fetch. */
function res(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response;
}

describe('api client', () => {
  beforeEach(() => {
    setAccessToken(null);
    setOnAuthLost(null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches the bearer token and parses JSON', async () => {
    setAccessToken('tok123');
    const fetchMock = vi.fn().mockResolvedValue(res(200, { hello: 'world' }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await api.get<{ hello: string }>('/things');
    expect(out).toEqual({ hello: 'world' });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok123');
    expect(init.credentials).toBe('include');
  });

  it('refreshes once on 401 and retries the original request', async () => {
    setAccessToken('stale');
    const fetchMock = vi
      .fn()
      // 1) original → 401
      .mockResolvedValueOnce(res(401, { message: 'expired' }))
      // 2) POST /auth/refresh → new token
      .mockResolvedValueOnce(res(200, { accessToken: 'fresh' }))
      // 3) retry → 200
      .mockResolvedValueOnce(res(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await api.get<{ ok: boolean }>('/secure');
    expect(out).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]![0])).toContain('/auth/refresh');
    // The retry carries the refreshed token.
    expect((fetchMock.mock.calls[2]![1].headers as Record<string, string>).Authorization).toBe(
      'Bearer fresh',
    );
  });

  it('calls onAuthLost and throws when refresh fails', async () => {
    setAccessToken('stale');
    const lost = vi.fn();
    setOnAuthLost(lost);
    const fetchMock = vi.fn().mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(401)); // refresh also 401
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/secure')).rejects.toBeInstanceOf(ApiError);
    expect(lost).toHaveBeenCalled();
  });

  it('login posts credentials and stores the access token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(res(200, { accessToken: 'abc', accessExpiresAt: 'x' }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await login('a@b.io', 'pw');
    expect(out.accessToken).toBe('abc');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/auth/login');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.io', password: 'pw' });
  });
});
