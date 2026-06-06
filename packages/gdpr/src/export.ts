import type { TenantId, UserId } from '@obikai/domain';

/**
 * Data-subject access / portability export (GDPR Art. 15 & 20), driven by the ROPA registry
 * (ADR-0007). The export walks every registered {@link ProcessingRecord} that defines `toExport`,
 * collects the subject's rows, and assembles a structured, machine-readable bundle. No DB
 * coupling here — the registry's injected `findBySubject` does the fetching.
 */

/** One model's contribution to an export: the model id and its exported rows. */
export interface DataExportSection {
  readonly model: string;
  readonly purpose: string;
  readonly records: readonly Readonly<Record<string, unknown>>[];
}

/**
 * The complete export handed to (or downloaded by) a data subject. Self-describing and
 * serializable to JSON; `schemaVersion` lets the format evolve without ambiguity.
 */
export interface DataExportBundle {
  readonly schemaVersion: string;
  readonly tenantId: TenantId;
  readonly subjectId: UserId;
  /** When the bundle was produced (epoch ms, injected clock). */
  readonly generatedAt: number;
  readonly sections: readonly DataExportSection[];
}

/**
 * Orchestrates a portability export across all exportable registered models. Implemented in the
 * app/worker layer (it has DB access via the registry's injected repositories); kept as an
 * interface here so @obikai/gdpr stays pure.
 */
export interface ExportService {
  /** Build a full export bundle for one subject within one tenant. */
  exportSubject(tenantId: TenantId, subjectId: UserId): Promise<DataExportBundle>;
}

/**
 * Reference description of how an {@link ExportService} should use the registry. (Not an
 * implementation — concrete services live downstream — but documents the contract so every
 * implementation behaves identically.)
 *
 * For each `record` in `registry.list()` where `record.toExport` is defined:
 *   rows = await record.findBySubject(tenantId, subjectId)
 *   section = { model, purpose, records: rows.map(record.toExport) }
 * Models without `toExport` are intentionally excluded from the subject's export.
 */
export const EXPORT_SCHEMA_VERSION = 'obikai-export-v1';

/** Convenience predicate an {@link ExportService} can use to select exportable records. */
export function isExportable(record: {
  toExport?: unknown;
}): record is { toExport: (row: unknown) => Readonly<Record<string, unknown>> } {
  return typeof record.toExport === 'function';
}
