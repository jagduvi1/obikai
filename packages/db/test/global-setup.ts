import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * Vitest global setup for the db package. Runs ONCE in the main process before any test worker spawns.
 *
 * Every db test file stands up its own in-memory MongoDB via `MongoMemoryServer.create()`. On a COLD
 * binary cache (e.g. a fresh CI runner) the parallel workers otherwise race to download/extract the
 * same `mongod` binary, and one worker's rename of `<binary>.tgz.downloading -> <binary>.tgz` fails
 * with `ENOENT` once another has already moved it — flaking the suite. Downloading the binary here
 * once, serially, warms the shared cache so every worker reuses it instead of racing.
 */
export async function setup(): Promise<void> {
  const server = await MongoMemoryServer.create();
  await server.stop();
}
