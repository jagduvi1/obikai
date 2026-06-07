import { type DynamicModule, Module } from '@nestjs/common';
import type { StoragePort } from '@obikai/adapter-contracts';
import { FsStorageProvider } from '@obikai/adapter-storage-fs';
import type { AppConfig } from '@obikai/config';
import { makeAdapterContext } from './adapter-context.js';
import { FilesController } from './files.controller.js';
import {
  FILES_CONFIG,
  type FilesConfig,
  STORAGE_PORT,
  deriveStorageSigningSecret,
} from './storage.tokens.js';

/**
 * Wires the StoragePort into the app (ADR-0019). Selected by `STORAGE_PROVIDER` (ADR-0009): the fs
 * default (built-ins only, self-host) or s3 (S3/MinIO). The port speaks presigned URLs only — for fs
 * those point at the guarded `/files` route (mounted here, fs only); for s3 they point at S3
 * directly, so no app route is needed. Global so any feature module can inject `STORAGE_PORT`.
 *
 * The s3 adapter (which drags in @aws-sdk) is imported DYNAMICALLY so fs deployments never load it.
 */
@Module({})
export class StorageModule {
  static forRoot(config: AppConfig): DynamicModule {
    const portProvider = {
      provide: STORAGE_PORT,
      useFactory: async (): Promise<StoragePort> => {
        const ctx = makeAdapterContext('storage');
        if (config.storage.provider === 'fs') {
          const provider = new FsStorageProvider(
            {
              root: config.storage.fsRoot,
              publicBaseUrl: config.storage.publicBaseUrl ?? '',
              signingSecret: deriveStorageSigningSecret(config.dataMasterKey),
            },
            ctx,
          );
          await provider.init();
          return provider;
        }
        const { S3StorageProvider } = await import('@obikai/adapter-storage-s3');
        const provider = new S3StorageProvider(
          {
            endpoint: config.storage.s3.endpoint,
            region: config.storage.s3.region,
            bucket: config.storage.s3.bucket,
            accessKeyId: config.storage.s3.accessKeyId,
            secretAccessKey: config.storage.s3.secretAccessKey,
            forcePathStyle: config.storage.s3.forcePathStyle,
          },
          ctx,
        );
        await provider.init();
        return provider;
      },
    };

    const isFs = config.storage.provider === 'fs';
    const filesConfig: FilesConfig = {
      root: config.storage.fsRoot,
      signingSecret: deriveStorageSigningSecret(config.dataMasterKey),
    };

    return {
      module: StorageModule,
      global: true,
      controllers: isFs ? [FilesController] : [],
      providers: isFs
        ? [portProvider, { provide: FILES_CONFIG, useValue: filesConfig }]
        : [portProvider],
      exports: [STORAGE_PORT],
    };
  }
}
