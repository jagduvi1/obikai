/**
 * Typed API client for the Obikai admin (ADR-0016). The access token lives in memory only (never
 * localStorage — XSS hygiene); the refresh token is an httpOnly cookie the api sets, so refresh
 * works without JS touching it. On a 401 the client transparently calls POST /auth/refresh (cookie
 * sent automatically via `credentials: 'include'`) once, then retries the original request. Tenant
 * is resolved by the api from the Host header, so the browser needs to send nothing extra.
 */

const BASE = import.meta.env.VITE_API_URL ?? '/api';

let accessToken: string | null = null;
/** Called when auth is irrecoverable (refresh failed) so the app can redirect to login. */
let onAuthLost: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}
export function setOnAuthLost(fn: (() => void) | null): void {
  onAuthLost = fn;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Internal: prevents infinite refresh recursion. */
  _retried?: boolean;
}

async function rawRequest(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    credentials: 'include',
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

/** Exchange the httpOnly refresh cookie for a fresh access token. Returns false if it failed. */
export async function refresh(): Promise<boolean> {
  const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
  if (!res.ok) return false;
  const data = (await parseBody(res)) as { accessToken?: string } | undefined;
  if (!data?.accessToken) return false;
  accessToken = data.accessToken;
  return true;
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await rawRequest(path, opts);

  // One transparent refresh-and-retry on 401 (skip the auth endpoints themselves).
  if (res.status === 401 && !opts._retried && !path.startsWith('/auth/')) {
    if (await refresh()) {
      res = await rawRequest(path, { ...opts, _retried: true });
    } else {
      onAuthLost?.();
    }
  }

  const body = await parseBody(res);
  if (!res.ok) {
    if (res.status === 401) onAuthLost?.();
    const message =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : `request failed (${res.status})`;
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
};

// ── Auth endpoints ───────────────────────────────────────────────────────────--
export interface LoginResult {
  accessToken: string;
  accessExpiresAt: string;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const result = await api.post<LoginResult>('/auth/login', { email, password });
  accessToken = result.accessToken;
  return result;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } finally {
    accessToken = null;
  }
}
