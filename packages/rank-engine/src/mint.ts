import { type VersionId, brand } from '@obikai/domain';
import { contentHash } from './canonical.js';
import type { ProgressionSystemVersion, ValidatedSystemDraft } from './types.js';

/**
 * Mint an immutable version from a validated draft (ADR-0005). The versionId IS the canonical
 * content hash, so re-minting identical content returns the prior version (no spurious version)
 * and any semantic change yields a new id — promotion history pins this id and is never rewritten.
 */
export function mintVersion(
  prior: ProgressionSystemVersion | null,
  draft: ValidatedSystemDraft,
): ProgressionSystemVersion {
  const core = {
    disciplineId: draft.disciplineId,
    systemId: draft.systemId,
    presentation: draft.presentation,
    tracks: draft.tracks,
    ladder: draft.ladder,
    transitions: draft.transitions,
    curricula: draft.curricula,
  };
  const hash = contentHash(core);
  if (prior && prior.contentHash === hash) return prior;
  return {
    systemId: draft.systemId,
    versionId: brand<VersionId>(hash),
    version: (prior?.version ?? 0) + 1,
    disciplineId: draft.disciplineId,
    presentation: draft.presentation,
    tracks: draft.tracks,
    ladder: draft.ladder,
    transitions: draft.transitions,
    curricula: draft.curricula,
    contentHash: hash,
  };
}
