/**
 * @obikai/adapter-storage-s3 — StoragePort over the S3 API (ADR-0003/0009).
 *
 * One adapter speaks to AWS S3, MinIO, Cloudflare R2 and Scaleway via the same
 * `endpoint` + `forcePathStyle` configuration: leave `endpoint` null for AWS, or point it at a
 * MinIO/R2 host with `forcePathStyle: true`. Only presigned URLs cross the wire — the app never
 * streams object bytes itself (invariant 10). The `@aws-sdk/*` SDK lives ONLY in this adapter and
 * no vendor type is re-exported: we map config + inputs to the port's plain DTOs (ADR-0003).
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

/** Non-secret S3 params, mirroring `AppConfig.storage.s3` (ADR-0009). Credentials are nullable so
 * the adapter can fall back to the AWS default provider chain (instance/role) in production. */
export const s3ParamsSchema = z.object({
  /** null ⇒ real AWS S3; a URL ⇒ MinIO/R2/Scaleway/etc. */
  endpoint: z.string().url().nullable(),
  region: z.string().min(1),
  bucket: z.string().min(1),
  accessKeyId: z.string().nullable(),
  secretAccessKey: z.string().nullable(),
  /** MinIO/R2 require path-style addressing; AWS uses virtual-hosted-style. */
  forcePathStyle: z.boolean(),
});

export type S3StorageParams = z.infer<typeof s3ParamsSchema>;

const DEFAULT_PUT_EXPIRY_SEC = 900;
const DEFAULT_GET_EXPIRY_SEC = 900;

const S3_CAPABILITIES: ReadonlySet<StorageCapability> = new Set<StorageCapability>([
  'presign-put',
  'presign-get',
  'delete',
  'list',
]);

export class S3StorageProvider implements StoragePort {
  readonly kind = 'storage' as const;
  readonly providerId = 's3';
  readonly capabilities = S3_CAPABILITIES;

  readonly #params: S3StorageParams;
  readonly #ctx: AdapterContext;
  readonly #client: S3Client;

  constructor(params: S3StorageParams, ctx: AdapterContext) {
    this.#params = params;
    this.#ctx = ctx;
    this.#client = new S3Client({
      region: params.region,
      forcePathStyle: params.forcePathStyle,
      ...(params.endpoint !== null ? { endpoint: params.endpoint } : {}),
      ...(params.accessKeyId !== null && params.secretAccessKey !== null
        ? {
            credentials: {
              accessKeyId: params.accessKeyId,
              secretAccessKey: params.secretAccessKey,
            },
          }
        : {}),
    });
  }

  init(): Promise<void> {
    this.#ctx.logger.info('s3 storage adapter initialised', {
      bucket: this.#params.bucket,
      region: this.#params.region,
      forcePathStyle: this.#params.forcePathStyle,
    });
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    this.#client.destroy();
    return Promise.resolve();
  }

  async health(): Promise<HealthStatus> {
    try {
      await this.#client.send(new HeadBucketCommand({ Bucket: this.#params.bucket }));
      return { ok: true };
    } catch (cause) {
      return { ok: false, detail: errorMessage(cause) };
    }
  }

  async presignPut(
    input: PresignPutInput,
  ): Promise<{ url: string; headers?: Record<string, string> }> {
    const command = new PutObjectCommand({
      Bucket: this.#params.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ...(input.maxBytes !== undefined ? { ContentLength: input.maxBytes } : {}),
    });
    const url = await getSignedUrl(this.#client, command, {
      expiresIn: input.expiresSec ?? DEFAULT_PUT_EXPIRY_SEC,
    });
    return { url, headers: { 'content-type': input.contentType } };
  }

  async presignGet(input: PresignGetInput): Promise<{ url: string }> {
    const command = new GetObjectCommand({ Bucket: this.#params.bucket, Key: input.key });
    const url = await getSignedUrl(this.#client, command, {
      expiresIn: input.expiresSec ?? DEFAULT_GET_EXPIRY_SEC,
    });
    return { url };
  }

  async delete(key: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#params.bucket, Key: key }));
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Factory the registry wires at boot (ADR-0009). Validates non-secret params with Zod before
 * constructing the provider; secrets are resolved by the registry into the params it passes. */
export const s3StorageFactory: ProviderFactory<S3StorageProvider, S3StorageParams> = {
  kind: 'storage',
  providerId: 's3',
  paramsSchema: s3ParamsSchema as Validator<S3StorageParams>,
  create(cfg: ResolvedAdapterConfig<S3StorageParams>, ctx: AdapterContext): S3StorageProvider {
    return new S3StorageProvider(cfg.params, ctx);
  },
};
