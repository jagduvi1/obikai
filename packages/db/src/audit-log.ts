import type { TenantId, UserId } from '@obikai/domain';
import {
  type ActorType,
  type AuditLogEntry,
  type ChainVerification,
  appendEntry,
  verifyChain,
} from '@obikai/gdpr';
import mongoose, { type Model, Schema, type Types } from 'mongoose';
import { getTenantIdOrThrow } from './tenant-context.js';
import { tenantGuard, tenantUniqueIndex } from './tenant-guard.js';

/**
 * Per-TENANT, append-only, hash-chained GDPR audit log (ADR-0007, ADR-0026). This is the tenant-scoped
 * accountability record (Art. 5(2)/30) for personal-data actions — member CRUD, promotions, consent
 * changes, data export and erasure. It is DISTINCT from the platform audit log (`platform-audit.ts`),
 * which is tenant-GLOBAL and records cross-tenant admin access; the two never share a chain.
 *
 * The hashing is reused verbatim from `@obikai/gdpr` (`appendEntry`/`hashChainEntry`/`verifyChain`,
 * scheme `obikai-audit-v1:`) — db implements the persistence port, gdpr owns the pure crypto (db→gdpr
 * is acyclic; gdpr never imports db, ADR-0026). There is intentionally NO update/delete path.
 *
 * Chain order is anchored by a monotonic, server-assigned per-tenant `seq` (unique-indexed), NOT the
 * wall clock or ObjectId — neither is monotonic across api replicas or under clock steps, which would
 * both falsely flag a valid chain as tampered AND wedge appends (same reasoning as platform-audit).
 * `seq` is storage-only: it is NOT part of the hashed payload and never appears in an `AuditLogEntry`.
 */
// Each concurrent append on a tenant's chain that loses the unique-seq/prevHash race retries against
// the advanced head; with K simultaneous appends the last one needs up to K attempts. 12 comfortably
// covers realistic per-tenant request concurrency (audit events are per-request, not bulk-parallel) —
// beyond that an append throws loudly rather than dropping an event silently.
const MAX_APPEND_ATTEMPTS = 12;

/** Storage shape: every {@link AuditLogEntry} field plus the per-tenant ordering anchor `seq`. */
interface AuditLogDoc {
  _id: Types.ObjectId;
  tenantId: string;
  /** Monotonic per-tenant insertion sequence (genesis = 0). The reliable chain-order anchor. */
  seq: number;
  ts: number;
  actorId: string | null;
  actorType: ActorType;
  action: string;
  targetType: string;
  targetId: string;
  /** PII-minimized change description; ABSENT (never null) when omitted, to keep the hash canonical. */
  diff?: Record<string, unknown>;
  /** Source IP; ABSENT (never null) when omitted, to keep the hash canonical. */
  ip?: string;
  prevHash: string | null;
  hash: string;
}

const schema = new Schema<AuditLogDoc>(
  {
    // Unique + monotonic PER TENANT: concurrent appends compute the same next seq, so the unique
    // index lets one win and the loser retry — keeping each tenant's chain strictly linear.
    seq: { type: Number, required: true },
    ts: { type: Number, required: true },
    actorId: { type: String, default: null },
    actorType: { type: String, required: true },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    // Mixed with NO default → the field stays ABSENT when not supplied. A stored `null` would be a
    // hashed value (canonicalize keeps null, omits undefined) and would break verification.
    diff: { type: Schema.Types.Mixed },
    ip: { type: String },
    // Genesis carries null; uniqueness is per tenant (see indexes) so each tenant has exactly one
    // genesis and no two entries chain off the same predecessor (a concurrent fork loses + retries).
    prevHash: { type: String, default: null },
    hash: { type: String, required: true },
  },
  { timestamps: false },
);
schema.plugin(tenantGuard);
// Per-tenant single linear chain: monotonic seq, one genesis (+ no forks) via prevHash, unique hash.
schema.index(...tenantUniqueIndex({ seq: 1 }));
schema.index(...tenantUniqueIndex({ prevHash: 1 }));
schema.index(...tenantUniqueIndex({ hash: 1 }));

export const AuditLogModel: Model<AuditLogDoc> =
  (mongoose.models.AuditLog as Model<AuditLogDoc> | undefined) ??
  mongoose.model<AuditLogDoc>('AuditLog', schema);

/** Map a stored doc back to the exact {@link AuditLogEntry} shape that was hashed (drop `_id`/`seq`). */
function toEntry(doc: AuditLogDoc): AuditLogEntry {
  return {
    tenantId: doc.tenantId as TenantId,
    ts: doc.ts,
    actorId: (doc.actorId as UserId | null) ?? null,
    actorType: doc.actorType,
    action: doc.action,
    targetType: doc.targetType,
    targetId: doc.targetId,
    // Re-include diff/ip ONLY when present so canonical hashing matches (undefined is omitted, not null).
    ...(doc.diff !== undefined && doc.diff !== null ? { diff: doc.diff } : {}),
    ...(doc.ip !== undefined && doc.ip !== null ? { ip: doc.ip } : {}),
    prevHash: doc.prevHash,
    hash: doc.hash,
  };
}

/** The caller-supplied part of an entry; `tenantId`, `ts`, `prevHash` and `hash` are filled in here. */
export interface AuditAppendInput {
  readonly actorId: UserId | null;
  readonly actorType: ActorType;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly diff?: Record<string, unknown>;
  readonly ip?: string;
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * Persistence for the per-tenant GDPR audit chain. All operations run inside the active TenantContext
 * (the `tenantGuard` scopes every query/write); there is no cross-tenant access path here.
 */
export class AuditLogRepository {
  constructor(
    private readonly model: Model<AuditLogDoc> = AuditLogModel,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Append an event to the active tenant's chain, chaining onto its current head. If a concurrent
   * append took the same head (the per-tenant unique `seq`/`prevHash` reject the fork), re-read the
   * head and retry a bounded number of times. Returns the committed entry.
   */
  async append(input: AuditAppendInput): Promise<AuditLogEntry> {
    const tenantId = getTenantIdOrThrow() as TenantId;
    for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt++) {
      const headDoc = await this.model.findOne({}).sort({ seq: -1 }).lean<AuditLogDoc>().exec();
      const prev = headDoc ? toEntry(headDoc) : null;
      const seq = headDoc ? headDoc.seq + 1 : 0;
      // gdpr.appendEntry sets prevHash from `prev` and computes the tamper-evident hash.
      const entry = appendEntry(prev, {
        tenantId,
        ts: this.now(),
        actorId: input.actorId,
        actorType: input.actorType,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        ...(input.diff !== undefined ? { diff: input.diff } : {}),
        ...(input.ip !== undefined ? { ip: input.ip } : {}),
      });
      try {
        await this.model.create({ ...entry, seq });
        return entry;
      } catch (err) {
        // A concurrent append took this seq/prevHash for the tenant; re-read the head and retry.
        if (isDuplicateKey(err)) continue;
        throw err;
      }
    }
    throw new Error('audit log append failed: too many concurrent chain conflicts');
  }

  /** The active tenant's newest entry (by monotonic seq), or null if the chain is empty. */
  async head(): Promise<AuditLogEntry | null> {
    const headDoc = await this.model.findOne({}).sort({ seq: -1 }).lean<AuditLogDoc>().exec();
    return headDoc ? toEntry(headDoc) : null;
  }

  /** The active tenant's full chain, oldest → newest (by seq). For export and verification. */
  async list(): Promise<AuditLogEntry[]> {
    const docs = await this.model.find({}).sort({ seq: 1 }).lean<AuditLogDoc[]>().exec();
    return docs.map(toEntry);
  }

  /** Verify the active tenant's chain is intact (links + recomputed hashes). Pure check over `list`. */
  async verify(): Promise<ChainVerification> {
    return verifyChain(await this.list());
  }
}
