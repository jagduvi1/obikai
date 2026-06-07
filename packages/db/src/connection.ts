import mongoose from 'mongoose';

/**
 * Thin connection helpers so the whole app shares ONE mongoose instance (the one the schemas in
 * this package registered their models on). Apps call `connectMongo` at boot; never import mongoose
 * directly elsewhere.
 */

/** Connection tuning. Defaults fail-fast at boot and bound the pool so a burst can't exhaust Mongo. */
export interface MongoConnectOptions {
  /** Bound how long `connect` waits for a reachable server before throwing (fast-fail boot). */
  readonly serverSelectionTimeoutMS?: number;
  readonly maxPoolSize?: number;
  readonly minPoolSize?: number;
  readonly socketTimeoutMS?: number;
}

let listenersBound = false;

/** Surface connection-loss/recovery once (idempotent). Uses stderr/stdout to avoid a logger dep. */
function bindConnectionListeners(): void {
  if (listenersBound) return;
  listenersBound = true;
  const line = (level: string, msg: string, extra?: Record<string, unknown>): void => {
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(`${JSON.stringify({ level, msg, ...(extra ?? {}) })}\n`);
  };
  mongoose.connection.on('error', (err: unknown) => {
    line('error', 'mongo connection error', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  mongoose.connection.on('disconnected', () => line('warn', 'mongo disconnected'));
  mongoose.connection.on('reconnected', () => line('info', 'mongo reconnected'));
}

export async function connectMongo(uri: string, opts: MongoConnectOptions = {}): Promise<void> {
  bindConnectionListeners();
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: opts.serverSelectionTimeoutMS ?? 5000,
    maxPoolSize: opts.maxPoolSize ?? 20,
    minPoolSize: opts.minPoolSize ?? 0,
    socketTimeoutMS: opts.socketTimeoutMS ?? 45_000,
  });
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

/** True once a live connection is established (readyState === 1). For readiness probes. */
export function isMongoConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
