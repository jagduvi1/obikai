import type { TenantId, UserId } from '@obikai/domain';

/**
 * Right-to-erasure (GDPR Art. 17) primitives (ADR-0007). Erasure is driven per-model by the ROPA
 * registry's {@link ProcessingRecord.erasure} strategy. Two rules are NON-NEGOTIABLE and encoded
 * directly in these types:
 *
 *   1. Erasure of immutable history is PSEUDONYMIZE-BY-REFERENCE, never in-place mutation.
 *      Promotion/grading logs (invariant 5) and their hash chains stay byte-identical. Person
 *      identifiers on those entries are indirected through an {@link IdentityMap}; erasure deletes
 *      the map row. Rank statistics/counts survive; the identity is gone. NEVER edit a log row.
 *
 *   2. Crypto-shred keys are PER-SUBJECT / PER-OBJECT — never per-tenant. A per-tenant key would
 *      destroy every member's blobs when erasing one member. Each subject's opaque blobs (waivers,
 *      photos) are encrypted under a per-subject (optionally per-object) data key wrapped by
 *      DATA_MASTER_KEY; erasure destroys the wrapped key, making the ciphertext — even in
 *      immutable backups — permanently unreadable.
 *
 * No DB coupling: every capability is an injected interface.
 */

/**
 * Per-model erasure strategy (ADR-0007):
 * - `hard_delete`  — physically remove the row (mutable, non-historical PII).
 * - `anonymize`    — keep the row, strip/pseudonymize identifying fields (stats preserved).
 * - `crypto_shred` — destroy the per-subject/per-object key so encrypted blobs become unreadable.
 * - `retain`       — keep the row for statutory reasons (e.g. bookkeeping), linked person
 *                    anonymized via the identity map.
 */
export const ERASURE_STRATEGIES = ['hard_delete', 'anonymize', 'crypto_shred', 'retain'] as const;
export type ErasureStrategy = (typeof ERASURE_STRATEGIES)[number];

/** Outcome of erasing one model for one subject. */
export interface ErasureModelResult {
  readonly model: string;
  readonly strategy: ErasureStrategy;
  /** Rows hard-deleted, anonymized, or whose keys were shredded. */
  readonly affected: number;
  /** Rows deliberately retained under statutory basis (their person link anonymized). */
  readonly retained: number;
}

/** Aggregate result of a subject-wide erasure run. */
export interface ErasureResult {
  readonly tenantId: TenantId;
  readonly subjectId: UserId;
  /** Epoch ms (injected clock) the erasure completed. */
  readonly erasedAt: number;
  readonly perModel: readonly ErasureModelResult[];
}

/**
 * Indirection collection that lets immutable history reference a data subject WITHOUT embedding
 * identity in the (immutable, hash-chained) log row. A {@link PseudonymRef} stored on a log entry
 * points at an {@link IdentityMap} row; resolving it yields the real subject. Erasure deletes the
 * map row — the dangling reference then resolves to "erased", and the log document plus its hash
 * chain are untouched.
 *
 * NOTE: a single log entry may reference SEVERAL distinct subjects (awardee, awarder, guardian,
 * signer) — each via its own pseudonym ref / map row — so erasing one does not affect the others.
 */
export interface PseudonymRef {
  /** Opaque key into the identity map (e.g. a random token), NOT the subject id. */
  readonly ref: string;
}

export interface IdentityMapRow {
  readonly tenantId: TenantId;
  readonly ref: string;
  readonly subjectId: UserId;
}

/**
 * The identity-map indirection. Hard-deleting a row is how erasure removes identity from
 * immutable history. There is intentionally no "update subjectId" path — references are stable.
 */
export interface IdentityMap {
  resolve(tenantId: TenantId, ref: PseudonymRef): Promise<UserId | null>;
  /** Hard-delete every map row pointing at this subject. THIS is pseudonymize-by-reference erasure. */
  eraseSubject(tenantId: TenantId, subjectId: UserId): Promise<number>;
}

/**
 * Per-subject / per-object crypto-shred key store. Keys are scoped to (tenant, subject[, object]),
 * NEVER per-tenant. Shredding destroys the wrapped data-encryption key so the corresponding
 * ciphertext blobs (incl. those in immutable backups) can never be decrypted again.
 */
export interface CryptoShredKeystore {
  /**
   * Destroy all wrapped data keys for a subject (optionally narrowed to one object) within a
   * tenant. Returns the number of keys destroyed. Irreversible by design.
   */
  shredSubjectKeys(tenantId: TenantId, subjectId: UserId, objectId?: string): Promise<number>;
}

/**
 * Orchestrates a subject-wide erasure across all registered models per their strategy. Lives in
 * the app/worker layer (runs inside `runInTenantContext`, so it cannot cross tenants — ADR-0007);
 * the interface is declared here to keep @obikai/gdpr DB-free.
 *
 * Implementations MUST, per ROPA record strategy:
 *   - hard_delete  → repository.delete(rows)
 *   - anonymize    → persist record.anonymize(row) (in-place mutation allowed for MUTABLE models)
 *   - crypto_shred → CryptoShredKeystore.shredSubjectKeys(...) (NEVER per-tenant key)
 *   - retain       → keep row; ensure its person link is anonymized via the IdentityMap
 * and, for immutable history, ONLY IdentityMap.eraseSubject(...) — never touch the log rows.
 */
export interface ErasureService {
  eraseSubject(tenantId: TenantId, subjectId: UserId): Promise<ErasureResult>;
}
