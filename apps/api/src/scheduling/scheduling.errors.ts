/**
 * Shared, framework-free errors for the scheduling services (scope §4.3). The controllers translate
 * these to Nest HTTP exceptions; keeping them here (mirroring members.service.ts) lets every
 * scheduling service unit-test against a fake store with no Nest dependency.
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

/** A request that is valid but conflicts with current state (e.g. booking a cancelled occurrence). */
export class ConflictError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'ConflictError';
  }
}
