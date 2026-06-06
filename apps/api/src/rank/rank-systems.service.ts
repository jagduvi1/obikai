import { type AuthzActor, can } from '@obikai/authz';
import type {
  ProgressionSystem,
  ProgressionSystemVersion,
  ValidationIssue,
  ValidationResult,
} from '@obikai/domain';
import { mintVersion, validateConfig } from '@obikai/rank-engine';

/**
 * RankSystemsService — authoring + reading versioned rank systems (ADR-0005/0015). The heavy
 * lifting is the PURE engine: `validateConfig` (a dry-run shape+structure check) and `mintVersion`
 * (hash a validated draft into an immutable version). This service only gates on the `rankSystem`
 * resource and persists the minted version. Editing a system NEVER mutates a version — it mints a
 * new one and repoints the handle (invariant 5). AI is never on this path.
 */

export class ForbiddenError extends Error {
  constructor(action: string, resource: string) {
    super(`forbidden: ${action} on ${resource}`);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

/** Raised when a submitted system config fails engine validation; carries the i18n-keyed issues. */
export class ValidationFailedError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super('rank system config validation failed');
    this.name = 'ValidationFailedError';
  }
}

/** The persistence surface RankSystemsService needs — satisfied by @obikai/db's RankSystemRepository. */
export interface RankSystemsStore {
  publishVersion(version: ProgressionSystemVersion): Promise<ProgressionSystemVersion>;
  getCurrentVersion(systemId: string): Promise<ProgressionSystemVersion | null>;
  getVersion(versionId: string): Promise<ProgressionSystemVersion | null>;
  listVersions(systemId: string): Promise<ProgressionSystemVersion[]>;
  getSystem(systemId: string): Promise<ProgressionSystem | null>;
  findSystemByDiscipline(disciplineId: string): Promise<ProgressionSystem | null>;
}

export class RankSystemsService {
  constructor(private readonly store: RankSystemsStore) {}

  /** Dry-run validation (no persistence) — returns the engine's valid/invalid result. */
  async validate(actor: AuthzActor, config: unknown): Promise<ValidationResult> {
    if (!can(actor, { resource: 'rankSystem', action: 'read' }))
      throw new ForbiddenError('read', 'rankSystem');
    return validateConfig(config);
  }

  /**
   * Validate → mint → persist a new immutable version. Throws ValidationFailedError (→ 400) if the
   * config is invalid. The prior current version (if any) is passed to `mintVersion` so the human
   * version number increments and identical content dedupes to the same hash.
   */
  async publish(actor: AuthzActor, config: unknown): Promise<ProgressionSystemVersion> {
    if (!can(actor, { resource: 'rankSystem', action: 'create' }))
      throw new ForbiddenError('create', 'rankSystem');
    const result = validateConfig(config);
    if (!result.valid) throw new ValidationFailedError(result.errors);
    const prior = await this.store.getCurrentVersion(result.draft.systemId);
    const version = mintVersion(prior, result.draft);
    return this.store.publishVersion(version);
  }

  async getSystemByDiscipline(actor: AuthzActor, disciplineId: string): Promise<ProgressionSystem> {
    if (!can(actor, { resource: 'rankSystem', action: 'read' }))
      throw new ForbiddenError('read', 'rankSystem');
    const sys = await this.store.findSystemByDiscipline(disciplineId);
    if (!sys) throw new NotFoundError('rankSystem', disciplineId);
    return sys;
  }

  async getCurrentVersion(actor: AuthzActor, systemId: string): Promise<ProgressionSystemVersion> {
    if (!can(actor, { resource: 'rankSystem', action: 'read' }))
      throw new ForbiddenError('read', 'rankSystem');
    const version = await this.store.getCurrentVersion(systemId);
    if (!version) throw new NotFoundError('rankSystem', systemId);
    return version;
  }

  async getVersion(actor: AuthzActor, versionId: string): Promise<ProgressionSystemVersion> {
    if (!can(actor, { resource: 'rankSystem', action: 'read' }))
      throw new ForbiddenError('read', 'rankSystem');
    const version = await this.store.getVersion(versionId);
    if (!version) throw new NotFoundError('rankSystemVersion', versionId);
    return version;
  }

  async listVersions(actor: AuthzActor, systemId: string): Promise<ProgressionSystemVersion[]> {
    if (!can(actor, { resource: 'rankSystem', action: 'list' }))
      throw new ForbiddenError('list', 'rankSystem');
    return this.store.listVersions(systemId);
  }
}
