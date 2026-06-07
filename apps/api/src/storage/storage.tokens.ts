import { createHmac } from 'node:crypto';

/** DI token for the resolved StoragePort (fs or s3), provided by StorageModule. */
export const STORAGE_PORT = 'STORAGE_PORT';

/** DI token for the fs `/files` route's config (root + signing secret); fs deployments only. */
export const FILES_CONFIG = 'FILES_CONFIG';

export interface FilesConfig {
  readonly root: string;
  readonly signingSecret: string;
}

/**
 * Derive the fs presign signing secret from the deployment's `DATA_MASTER_KEY` (ADR-0009) rather
 * than adding another required secret. A labelled HMAC subkey keeps it cryptographically separate
 * from any other use of the master key.
 */
export function deriveStorageSigningSecret(dataMasterKey: string): string {
  return createHmac('sha256', dataMasterKey).update('obikai/storage-fs/v1').digest('hex');
}
