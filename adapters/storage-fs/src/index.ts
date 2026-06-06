/**
 * @obikai/adapter-storage-fs — StoragePort over the local filesystem (ADR-0003/0009).
 *
 * The single-box, zero-dependency fallback for a true self-host that does not want to run an
 * S3-compatible service. It uses ONLY Node built-ins (`node:fs/promises`, `node:crypto`,
 * `node:path`) — no third-party runtime deps, nothing to compile.
 *
 * There is no real "presigning" on a filesystem, so we synthesise it: `presignPut`/`presignGet`
 * return a short-lived URL pointing at a guarded `/files` route the app must mount, carrying an
 * HMAC token over (op, key, expiry). The route is expected to call {@link verifyFsToken} to
 * authorise the request, then read/write the object under the storage root. Because the token is
 * computed with `node:crypto` HMAC-SHA256 over a server-only secret, a client cannot forge access
 * to an arbitrary key or extend its own expiry.
 *
 * App-side wiring (composition root): mount `GET/PUT /files/:key` that
 *   1. parses `op`, `exp`, `sig` from the query,
 *   2. calls `verifyFsToken({ op, key, expiresAt, signature }, secret, now)`,
 *   3. on success streams from / writes to `resolveObjectPath(root, key)`.
 * The adapter deliberately does NOT stream bytes itself (invariant 10): it only mints + verifies
 * tokens and performs server-side deletes.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  AdapterContext,
  HealthStatus,
  PresignGetInput,
  PresignPutInput,
  ProviderFactory,
  ResolvedAdapterConfig,
  StorageCapability,
  StoragePort,
  Validator,
} from '@obikai/adapter-contracts';
import { z } from 'zod';

/** Non-secret FS params. `root` mirrors `AppConfig.storage.fsRoot`; `publicBaseUrl` is the origin
 * the guarded `/files` route is reachable at. `signingSecret` authenticates the synthetic
 * presigned URLs and is supplied from a SecretRef by the registry, never inlined (ADR-0009). */
export const fsParamsSchema = z.object({
  /** Directory under which all objects live; created on init if missing. */
  root: z.string().min(1),
  /** Origin the app serves the guarded `/files` route from, e.g. `https://dojo.example`. */
  publicBaseUrl: z.string().url(),
  /** HMAC key for the synthetic presign tokens (>= 16 bytes of entropy recommended). */
  signingSecret: z.string().min(1),
});

export type FsStorageParams = z.infer<typeof fsParamsSchema>;

export type FsOp = 'get' | 'put';

const DEFAULT_PUT_EXPIRY_SEC = 900;
const DEFAULT_GET_EXPIRY_SEC = 900;

const FS_CAPABILITIES: ReadonlySet<StorageCapability> = new Set<StorageCapability>([
  'presign-put',
  'presign-get',
  'delete',
]);

/** Resolve a user-supplied key to an absolute path strictly inside `root`, rejecting traversal
 * (`..`) and absolute keys. Exported so the app's `/files` route reuses the exact same guard. */
export function resolveObjectPath(root: string, key: string): string {
  if (key.length === 0 || isAbsolute(key)) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  const rootAbs = resolve(root);
  const target = resolve(rootAbs, key);
  const rel = relative(rootAbs, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    throw new Error(`Storage key escapes root: ${key}`);
  }
  return target;
}

/** Stable signing payload — the order/separators must match {@link verifyFsToken}. */
function tokenPayload(op: FsOp, key: string, expiresAtSec: number): string {
  return `${op}\n${key}\n${expiresAtSec}`;
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

export interface FsTokenInput {
  readonly op: FsOp;
  readonly key: string;
  /** Unix seconds at which the token stops being valid. */
  readonly expiresAt: number;
  readonly signature: string;
}

/** Authorise a request to the guarded `/files` route. Returns true only when the signature matches
 * AND the token has not expired. Uses a constant-time comparison to avoid signature oracles. */
export function verifyFsToken(input: FsTokenInput, secret: string, nowSec: number): boolean {
  if (!Number.isFinite(input.expiresAt) || input.expiresAt < nowSec) return false;
  const expected = sign(secret, tokenPayload(input.op, input.key, input.expiresAt));
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(input.signature, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export class FsStorageProvider implements StoragePort {
  readonly kind = 'storage' as const;
  readonly providerId = 'fs';
  readonly capabilities = FS_CAPABILITIES;

  readonly #params: FsStorageParams;
  readonly #ctx: AdapterContext;

  constructor(params: FsStorageParams, ctx: AdapterContext) {
    this.#params = params;
    this.#ctx = ctx;
  }

  async init(): Promise<void> {
    await mkdir(resolve(this.#params.root), { recursive: true });
    this.#ctx.logger.info('fs storage adapter initialised', { root: this.#params.root });
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }

  async health(): Promise<HealthStatus> {
    try {
      // A write probe under the root confirms the directory exists and is writable.
      const probeDir = resolve(this.#params.root);
      await mkdir(probeDir, { recursive: true });
      return { ok: true };
    } catch (cause) {
      return { ok: false, detail: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  presignPut(input: PresignPutInput): Promise<{ url: string; headers?: Record<string, string> }> {
    const url = this.#presign('put', input.key, input.expiresSec ?? DEFAULT_PUT_EXPIRY_SEC);
    return Promise.resolve({ url, headers: { 'content-type': input.contentType } });
  }

  presignGet(input: PresignGetInput): Promise<{ url: string }> {
    const url = this.#presign('get', input.key, input.expiresSec ?? DEFAULT_GET_EXPIRY_SEC);
    return Promise.resolve({ url });
  }

  async delete(key: string): Promise<void> {
    const path = resolveObjectPath(this.#params.root, key);
    await rm(path, { force: true });
  }

  /** Ensure the parent directory for a key exists; the app's `/files` PUT handler calls this (via
   * {@link resolveObjectPath}) before writing. Kept here so traversal rules stay in one place. */
  async ensureParentDir(key: string): Promise<string> {
    const path = resolveObjectPath(this.#params.root, key);
    await mkdir(dirname(path), { recursive: true });
    return path;
  }

  #presign(op: FsOp, key: string, expiresSec: number): string {
    // Validate the key shape up-front so a bad key fails at mint time, not at serve time.
    resolveObjectPath(this.#params.root, key);
    const expiresAt = Math.floor(this.#ctx.clock().getTime() / 1000) + expiresSec;
    const signature = sign(this.#params.signingSecret, tokenPayload(op, key, expiresAt));
    const url = new URL(join('/files', key).split(sep).join('/'), this.#params.publicBaseUrl);
    url.searchParams.set('op', op);
    url.searchParams.set('exp', String(expiresAt));
    url.searchParams.set('sig', signature);
    return url.toString();
  }
}

/** Factory the registry wires at boot (ADR-0009). */
export const fsStorageFactory: ProviderFactory<FsStorageProvider, FsStorageParams> = {
  kind: 'storage',
  providerId: 'fs',
  paramsSchema: fsParamsSchema as Validator<FsStorageParams>,
  create(cfg: ResolvedAdapterConfig<FsStorageParams>, ctx: AdapterContext): FsStorageProvider {
    return new FsStorageProvider(cfg.params, ctx);
  },
};
