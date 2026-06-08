import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * Vitest global setup for the worker integration suite. Warms the shared mongodb-memory-server binary
 * cache once before workers spawn, so a cold cache doesn't race to download/extract `mongod`. Mirrors
 * packages/db and apps/api.
 */
export async function setup(): Promise<void> {
  const server = await MongoMemoryServer.create();
  await server.stop();
}
