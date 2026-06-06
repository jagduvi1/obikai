import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { TenantId, UserId } from '@obikai/domain';

/**
 * Append-only, hash-chained audit log (ADR-0007, invariant 6). Each entry's `hash` commits to a
 * canonical serialization of the entry AND the previous entry's hash, so any retroactive edit,
 * deletion, or reordering breaks the chain at the tampered point and everything after it. There
 * is no update/delete path — the log is tamper-evident by construction.
 *
 * Pure + isomorphic: hashing uses @noble/hashes (no node:crypto), matching the rank engine's
 * content-hash convention (ADR-0005), so it runs identically server-side and in tests.
 */

const SCHEME_PREFIX = 'obikai-audit-v1:';

/** Who performed an action — humans, the system itself, or an external/integration actor. */
export const ACTOR_TYPES = ['user', 'system', 'integration'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/**
 * One audit log entry. `prevHash` is null only for the genesis entry of a tenant's chain.
 * `hash` is derived (see {@link hashChainEntry}) and is what the next entry chains onto.
 * Diffs are PII-minimized (record field names / coarse before-after, not raw subject data).
 */
export interface AuditLogEntry {
  readonly tenantId: TenantId;
  /** Event timestamp in epoch milliseconds (injected clock — never read ambiently). */
  readonly ts: number;
  /** The acting user, or null for system-originated actions. */
  readonly actorId: UserId | null;
  readonly actorType: ActorType;
  /** Verb describing what happened, e.g. 'member.update' | 'gdpr.erase'. */
  readonly action: string;
  /** The kind of entity acted upon, e.g. 'member' | 'promotion'. */
  readonly targetType: string;
  readonly targetId: string;
  /** PII-minimized change description, if any. */
  readonly diff?: Readonly<Record<string, unknown>>;
  /** Source IP, if captured. */
  readonly ip?: string;
  /** Hash of the previous entry in this tenant's chain; null for the first (genesis) entry. */
  readonly prevHash: string | null;
  /** Tamper-evident digest of this entry + prevHash. */
  readonly hash: string;
}

/** The signed payload — every field except the derived `hash`. */
export type AuditLogEntryInput = Omit<AuditLogEntry, 'hash'>;

/**
 * Canonical JSON: object keys sorted, arrays keep order, `undefined` omitted. Deterministic so
 * the same logical entry always hashes identically regardless of field insertion order.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    if (v === undefined) continue;
    out[key] = canonicalize(v);
  }
  return out;
}

export function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Compute the hash for an entry: sha256(scheme + canonicalJSON(entryWithoutHash) + prevHash).
 * `prev` is the previous entry (or null for genesis); its hash MUST equal `entry.prevHash` or
 * the chain is inconsistent. Returns the hex digest to store as `entry.hash`.
 *
 * Pure: same inputs → same output, no I/O, no ambient clock.
 */
export function hashChainEntry(prev: AuditLogEntry | null, entry: AuditLogEntryInput): string {
  const prevHash = prev === null ? null : prev.hash;
  // The entry already carries prevHash; fold prevHash in again explicitly so a genesis-vs-link
  // mismatch (entry.prevHash disagreeing with the actual predecessor) changes the digest.
  const payload = canonicalJSON(entry) + (prevHash ?? '');
  return bytesToHex(sha256(SCHEME_PREFIX + payload));
}

/**
 * Build a fully-formed, chained entry from its payload and the previous entry. Sets `prevHash`
 * from `prev` and computes `hash`. This is the only sanctioned way to append — it guarantees the
 * link is consistent.
 */
export function appendEntry(
  prev: AuditLogEntry | null,
  payload: Omit<AuditLogEntryInput, 'prevHash'>,
): AuditLogEntry {
  const prevHash = prev === null ? null : prev.hash;
  const input: AuditLogEntryInput = { ...payload, prevHash };
  const hash = hashChainEntry(prev, input);
  return { ...input, hash };
}

/** Result of verifying a chain. `index` points at the first broken entry when `valid` is false. */
export type ChainVerification =
  | { readonly valid: true }
  | { readonly valid: false; readonly index: number; readonly reason: string };

/**
 * Verify an ordered chain of entries (oldest → newest). Checks, for each entry: that `prevHash`
 * links to the actual predecessor (null only at genesis), and that `hash` recomputes from the
 * entry's content. Any tamper — edited field, deleted entry, reordering — fails verification at
 * the offending index. Pure; never throws.
 */
export function verifyChain(entries: readonly AuditLogEntry[]): ChainVerification {
  let prev: AuditLogEntry | null = null;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === undefined) return { valid: false, index: i, reason: 'missing entry' };
    const expectedPrevHash = prev === null ? null : prev.hash;
    if (entry.prevHash !== expectedPrevHash) {
      return { valid: false, index: i, reason: 'prevHash does not link to predecessor' };
    }
    const { hash, ...input } = entry;
    const recomputed = hashChainEntry(prev, input);
    if (recomputed !== hash) {
      return { valid: false, index: i, reason: 'hash does not match entry content' };
    }
    prev = entry;
  }
  return { valid: true };
}

/**
 * Repository port for the audit log — injected by the app layer. There is intentionally NO
 * update or delete method: the log is append-only and tamper-evident (ADR-0007).
 */
export interface AuditLogRepository {
  /** The newest entry for a tenant, to chain the next append onto (null if the chain is empty). */
  head(tenantId: TenantId): Promise<AuditLogEntry | null>;
  append(entry: AuditLogEntry): Promise<void>;
  /** Entries in chain order (oldest → newest) for verification/export. */
  list(tenantId: TenantId): Promise<readonly AuditLogEntry[]>;
}
