import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@obikai/config';
import { describe, expect, it } from 'vitest';
import { FilesController } from './files.controller.js';
import { StorageModule } from './storage.module.js';
import { FILES_CONFIG, STORAGE_PORT } from './storage.tokens.js';

/** Minimal AppConfig covering only the fields StorageModule reads. */
function config(over: Partial<AppConfig['storage']>): AppConfig {
  return {
    dataMasterKey: 'a'.repeat(32),
    storage: {
      provider: 'fs',
      s3: {
        endpoint: null,
        region: 'eu-north-1',
        bucket: 'obikai',
        accessKeyId: null,
        secretAccessKey: null,
        forcePathStyle: true,
      },
      fsRoot: join(tmpdir(), 'obikai-storage-module-test'),
      publicBaseUrl: 'https://dojo.example',
      ...over,
    },
  } as AppConfig;
}

// biome-ignore lint/suspicious/noExplicitAny: provider entries are heterogeneous DI descriptors.
const findProvider = (mod: { providers?: any[] }, token: unknown) =>
  (mod.providers ?? []).find((p) => p && typeof p === 'object' && p.provide === token);

describe('StorageModule.forRoot', () => {
  it('fs: mounts the /files controller, provides FILES_CONFIG + STORAGE_PORT, and is global', () => {
    const mod = StorageModule.forRoot(config({ provider: 'fs' }));
    expect(mod.global).toBe(true);
    expect(mod.controllers).toContain(FilesController);
    expect(mod.exports).toContain(STORAGE_PORT);
    expect(findProvider(mod, FILES_CONFIG)).toBeDefined();
    expect(findProvider(mod, STORAGE_PORT)).toBeDefined();
  });

  it('s3: no /files controller and no FILES_CONFIG (presigns to S3 directly)', () => {
    const mod = StorageModule.forRoot(
      config({ provider: 's3', endpoint: 'https://minio.example' }),
    );
    expect(mod.controllers ?? []).not.toContain(FilesController);
    expect(findProvider(mod, FILES_CONFIG)).toBeUndefined();
    expect(findProvider(mod, STORAGE_PORT)).toBeDefined();
  });

  it('the fs STORAGE_PORT factory constructs an initialised fs provider', async () => {
    const mod = StorageModule.forRoot(config({ provider: 'fs' }));
    const provider = findProvider(mod, STORAGE_PORT);
    const port = await provider.useFactory();
    expect(port.providerId).toBe('fs');
    // A round-tripable presign proves the provider is usable post-init.
    const { url } = await port.presignGet({ key: 'probe.txt' });
    expect(url).toContain('/files/probe.txt');
  });
});
