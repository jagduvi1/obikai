import type { TenantId } from '@obikai/domain';
import type { LawfulBasis } from './consent.js';
import type { ErasureStrategy } from './erasure.js';

/**
 * Typed ROPA / retention registry (ADR-0007, "Records of Processing Activities"). Every
 * PII-bearing model in the system registers a {@link ProcessingRecord} describing its purpose,
 * lawful basis, controller/processor role, retention, export inclusion and erasure strategy.
 * The registry then DRIVES export and erasure — GDPR accountability is executable code, not a
 * drifting Word document.
 *
 * CI GUARD IDEA: a build-time check enumerates every persisted model that carries PII-tagged
 * fields and asserts each one has a matching `ProcessingRecord` here. A new PII model that is not
 * registered fails CI — so export/erasure can never silently miss data.
 */

/** GDPR Art. 4(7)/(8): the tenant is the controller or (merely) a processor for this model. */
export const PROCESSING_ROLES = ['controller', 'processor'] as const;
export type ProcessingRole = (typeof PROCESSING_ROLES)[number];

/**
 * A retention rule. Either a bounded period (statutory or policy) or explicitly indefinite.
 * `legalBasis` documents WHY a period applies, e.g. 'Nordic bookkeeping law (~7y)'.
 */
export type Retention =
  | { readonly kind: 'period'; readonly days: number; readonly legalBasis: string }
  | { readonly kind: 'until_erasure' }
  | { readonly kind: 'indefinite'; readonly justification: string };

/**
 * Registration for one PII-bearing model. `T` is the model's row/document type so `findBySubject`,
 * `toExport` and `anonymize` are type-safe per model. Repository access is injected: the registry
 * itself never touches a DB.
 */
export interface ProcessingRecord<T> {
  /** Stable model identifier, e.g. 'member' | 'promotionLog' | 'invoice'. */
  readonly model: string;
  /** Why this data is processed (human-readable, surfaces in the generated ROPA). */
  readonly purpose: string;
  readonly lawfulBasis: LawfulBasis;
  readonly role: ProcessingRole;
  readonly retention: Retention;
  /**
   * Fetch all rows of this model that concern a given data subject within a tenant. Used by both
   * export and erasure to locate the subject's footprint. Injected (DB-agnostic).
   */
  findBySubject(tenantId: TenantId, subjectId: string): Promise<readonly T[]>;
  /**
   * Optional transform of a row into its export representation (PII the subject is entitled to,
   * Art. 15/20). Omit to exclude this model from data-subject exports entirely.
   */
  toExport?(row: T): Readonly<Record<string, unknown>>;
  /** How this model satisfies a right-to-erasure request (Art. 17). */
  readonly erasure: ErasureStrategy;
  /**
   * Required iff `erasure` is `anonymize`: return the row with the subject's identifying fields
   * stripped/pseudonymized while preserving non-identifying, statistically-useful columns.
   * Pure transform — the caller persists the result.
   */
  anonymize?(row: T): T;
}

/**
 * In-memory registry of processing records, keyed by `model`. Constructed once at app boot and
 * populated by each domain module registering its PII models. List/iterate to generate the ROPA
 * document and to drive export/erasure across every registered model.
 */
export class RopaRegistry {
  // Values are heterogeneous in their T; `unknown` is the safe erased element type. Callers that
  // know the concrete model retrieve via `get<T>` with the matching type argument.
  private readonly records = new Map<string, ProcessingRecord<unknown>>();

  /** Register a model. Throws on duplicate `model` so two modules can't silently shadow each other. */
  register<T>(record: ProcessingRecord<T>): void {
    if (this.records.has(record.model)) {
      throw new Error(`ROPA: model already registered: ${record.model}`);
    }
    this.records.set(record.model, record as ProcessingRecord<unknown>);
  }

  get<T = unknown>(model: string): ProcessingRecord<T> | undefined {
    return this.records.get(model) as ProcessingRecord<T> | undefined;
  }

  has(model: string): boolean {
    return this.records.has(model);
  }

  /** All registered records — the source of truth for the generated ROPA + CI guard. */
  list(): readonly ProcessingRecord<unknown>[] {
    return [...this.records.values()];
  }

  /** Registered model identifiers, for the CI "every PII model is registered" assertion. */
  models(): readonly string[] {
    return [...this.records.keys()];
  }
}
