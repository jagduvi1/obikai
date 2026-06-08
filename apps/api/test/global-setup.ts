import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * Vitest global setup for the api integration suite. Runs ONCE before any worker spawns, warming the
 * shared mongodb-memory-server binary cache so parallel/serial files don't race to download/extract
 * `mongod` on a cold cache (the `.downloading` rename ENOENT seen in CI). Mirrors packages/db.
 */
export async function setup(): Promise<void> {
  const server = await MongoMemoryServer.create();
  await server.stop();
}
