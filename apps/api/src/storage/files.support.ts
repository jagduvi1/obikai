import { verifyFsToken } from '@obikai/adapter-storage-fs';

/**
 * Pure helpers for the guarded `/files` route (fs storage only). The route itself streams bytes; the
 * security-relevant decisions — key extraction, op/expiry/signature verification, and content-type —
 * live here so they unit-test without a running server. Path-traversal safety is enforced separately
 * by the adapter's `resolveObjectPath` when the route resolves the on-disk path.
 */

export type FilesOp = 'get' | 'put';

/** The storage key from a `/files/<key>` request path (URL-decoded; prefix stripped). */
export function decodeKey(reqPath: string): string {
  const prefix = '/files/';
  const raw = reqPath.startsWith(prefix) ? reqPath.slice(prefix.length) : reqPath;
  return decodeURIComponent(raw);
}

/** Map a key's extension to a response Content-Type; unknown → octet-stream (safe default). */
export function contentTypeForKey(key: string): string {
  const dot = key.lastIndexOf('.');
  const ext = dot >= 0 ? key.slice(dot + 1).toLowerCase() : '';
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

export interface FilesQuery {
  op?: string;
  exp?: string;
  sig?: string;
}

/**
 * Authorize a `/files` request: the query must carry op/exp/sig, the op must match the HTTP method's
 * intent, and the HMAC token (over op+key+expiry, against the server signing secret) must verify and
 * be unexpired. Mirrors exactly what the fs adapter signed at presign time.
 */
export function authorizeFsRequest(
  method: FilesOp,
  key: string,
  query: FilesQuery,
  secret: string,
  nowSec: number,
): boolean {
  if (!query.op || !query.exp || !query.sig) return false;
  if (query.op !== method) return false;
  const expiresAt = Number(query.exp);
  if (!Number.isFinite(expiresAt)) return false;
  return verifyFsToken({ op: method, key, expiresAt, signature: query.sig }, secret, nowSec);
}
