import type { Adapter } from './base.js';

/**
 * StoragePort — default speaks the S3 API (works against MinIO/AWS/R2/Scaleway with one
 * endpoint+forcePathStyle config), with a local-filesystem fallback for true single-box
 * self-host (ADR-0003/0009). The app exposes only presigned URLs and never streams file bytes;
 * waivers/certs/photos/curriculum media live in object storage, not Mongo (invariant 10).
 */
export type StorageCapability = 'presign-put' | 'presign-get' | 'delete' | 'list';

export interface PresignPutInput {
  readonly key: string;
  readonly contentType: string;
  readonly maxBytes?: number;
  readonly expiresSec?: number;
}

export interface PresignGetInput {
  readonly key: string;
  readonly expiresSec?: number;
}

export interface StoragePort extends Adapter<StorageCapability> {
  readonly kind: 'storage';
  presignPut(input: PresignPutInput): Promise<{ url: string; headers?: Record<string, string> }>;
  presignGet(input: PresignGetInput): Promise<{ url: string }>;
  delete(key: string): Promise<void>;
}
