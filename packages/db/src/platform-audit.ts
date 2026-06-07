import { createHash } from 'node:crypto';
import type { PlatformAuditAppend, PlatformAuditEntry } from '@obikai/domain';
import mongoose, { type Model, Schema, type Types } from 'mongoose';
import { PlatformContextError } from './errors.js';
import { isPlatformContext } from './tenant-context.js';

/**
 * Platform audit-log persistence (ADR-0023). A single, global, APPEND-ONLY, hash-chained log of
 * cross-tenant platform actions. TENANT-GLOBAL (no `tenantGuard`, like User/Tenant/PlatformGrant —
 * it is not data owned by any tenant). There is intentionally NO update/delete path: edits,
 * reordering, and internal/prefix deletions all break the chain and fail `verifyPlatformAuditChain`.
 * (Truncation of the NEWEST entries is the inherent limit of any backward hash chain — undetectable
 * without an external, independently-stored head anchor; out of scope for v1.)
 *
 * Chain order is anchored by a monotonic, server-assigned `seq` (unique-indexed), NOT by the wall
 * clock or ObjectId: `ts`/`_id` are not monotonic across API replicas or under clock steps, which
 * would otherwise both falsely flag a valid chain as tampered AND wedge appends. `seq` strictly
 * increases with insertion regardless of process/clock, so head = max(seq) is always the true tail.
 * Enumeration is a cross-tenant read, so `list` requires the explicit platform marker; appends run
 * during platform requests (already under `runAsPlatform`).
 */
const SCHEME = 'obikai-platform-audit-v1:';
const MAX_APPEND_ATTEMPTS = 5;

export interface PlatformAuditDoc {
  _id: Types.ObjectId;
  /** Monotonic insertion sequence (genesis = 0). The reliable chain-order anchor (see file header). */
  seq: number;
  ts: number;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  ip: string | null;
  prevHash: string | null;
  hash: string;
}

const schema = new Schema<PlatformAuditDoc>(
  {
    // Unique + monotonic: concurrent appends compute the same next seq, so the unique index lets one
    // win and the loser retry — keeping the chain strictly linear and ordered independent of clocks.
    seq: { type: Number, required: true, unique: true },
    ts: { type: Number, required: true },
    actorUserId: { type: String, default: null },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    ip: { type: String, default: null },
    // Genesis carries null; the unique index makes a single global chain — at most one genesis and
    // no two entries chaining off the same predecessor (a concurrent fork loses the insert + retries).
    prevHash: { type: String, default: null, unique: true },
    hash: { type: String, required: true, unique: true },
  },
  { timestamps: false },
);

export const PlatformAuditModel: Model<PlatformAuditDoc> =
  (mongoose.models.PlatformAudit as Model<PlatformAuditDoc> | undefined) ??
  mongoose.model<PlatformAuditDoc>('PlatformAudit', schema);

/**
 * The exact, stable payload that gets hashed. Serialized as a JSON ARRAY in a fixed field order:
 * JSON escaping makes it injection-safe (no delimiter to forge), and `null` stays distinct from `""`.
 */
function payloadOf(entry: Omit<PlatformAuditEntry, 'id' | 'hash'>): string {
  return JSON.stringify([
    entry.ts,
    entry.actorUserId,
    entry.action,
    entry.targetType,
    entry.targetId,
    entry.ip,
    entry.prevHash,
  ]);
}

/** Pure tamper-evident digest of an entry (content + prevHash). Exported for tests/verification. */
export function hashPlatformAuditEntry(entry: Omit<PlatformAuditEntry, 'id' | 'hash'>): string {
  return createHash('sha256')
    .update(SCHEME + payloadOf(entry))
    .digest('hex');
}

export type PlatformChainVerification =
  | { readonly valid: true }
  | { readonly valid: false; readonly index: number; readonly reason: string };

/** Verify an ordered chain (oldest → newest): links + recomputed hashes. Pure; never throws. */
export function verifyPlatformAuditChain(
  entries: readonly PlatformAuditEntry[],
): PlatformChainVerification {
  let prevHash: string | null = null;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === undefined) return { valid: false, index: i, reason: 'missing entry' };
    if (entry.prevHash !== prevHash) {
      return { valid: false, index: i, reason: 'prevHash does not link to predecessor' };
    }
    const { id: _id, hash, ...content } = entry;
    if (hashPlatformAuditEntry(content) !== hash) {
      return { valid: false, index: i, reason: 'hash does not match entry content' };
    }
    prevHash = entry.hash;
  }
  return { valid: true };
}

function toEntry(doc: PlatformAuditDoc): PlatformAuditEntry {
  return {
    id: doc._id.toString(),
    ts: doc.ts,
    actorUserId: doc.actorUserId,
    action: doc.action,
    targetType: doc.targetType,
    targetId: doc.targetId,
    ip: doc.ip,
    prevHash: doc.prevHash,
    hash: doc.hash,
  };
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

export class PlatformAuditRepository {
  constructor(
    private readonly model: Model<PlatformAuditDoc> = PlatformAuditModel,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Append an entry, chaining it onto the current head. If a concurrent append took the same head
   * (the unique `prevHash` rejects the fork), re-read the head and retry a bounded number of times.
   */
  async append(input: PlatformAuditAppend): Promise<PlatformAuditEntry> {
    for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt++) {
      // Head = max(seq) — a reliable tail regardless of clock/process (unlike ts/_id).
      const head = await this.model.findOne({}).sort({ seq: -1 }).lean<PlatformAuditDoc>();
      const prevHash = head ? head.hash : null;
      const seq = head ? head.seq + 1 : 0;
      const content = {
        ts: this.now(),
        actorUserId: input.actorUserId,
        action: String(input.action),
        targetType: String(input.targetType),
        targetId: String(input.targetId),
        ip: input.ip,
        prevHash,
      };
      const hash = hashPlatformAuditEntry(content);
      try {
        const created = await this.model.create({ ...content, seq, hash });
        return toEntry(created.toObject() as unknown as PlatformAuditDoc);
      } catch (err) {
        // A concurrent append took this seq/prevHash; re-read the (now-advanced) head and retry.
        if (isDuplicateKey(err)) continue;
        throw err;
      }
    }
    throw new Error('platform audit append failed: too many concurrent chain conflicts');
  }

  /** The whole chain, oldest → newest (by monotonic seq). Cross-tenant read — platform marker only. */
  async list(): Promise<PlatformAuditEntry[]> {
    if (!isPlatformContext()) {
      throw new PlatformContextError(
        'PlatformAuditRepository.list reads the cross-tenant audit log and must run inside runAsPlatform(...)',
      );
    }
    const docs = await this.model.find({}).sort({ seq: 1 }).lean<PlatformAuditDoc[]>().exec();
    return docs.map(toEntry);
  }
}
