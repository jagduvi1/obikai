import mongoose from 'mongoose';

/**
 * Thin connection helpers so the whole app shares ONE mongoose instance (the one the schemas in
 * this package registered their models on). Apps call `connectMongo` at boot; never import mongoose
 * directly elsewhere.
 */
export async function connectMongo(uri: string): Promise<void> {
  await mongoose.connect(uri);
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

/** True once a live connection is established (readyState === 1). For readiness probes. */
export function isMongoConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
