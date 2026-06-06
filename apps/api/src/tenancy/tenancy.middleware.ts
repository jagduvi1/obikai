import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { AppConfig } from '@obikai/config';
import { type TenantContext, runInTenantContext } from '@obikai/db';
import { type TenantId, type UserId, brand } from '@obikai/domain';
import type { NextFunction, Request, Response } from 'express';
import { APP_CONFIG } from '../config.provider.js';
import { resolveTenantFromHost } from './tenant-resolver.js';

/**
 * Opens an AsyncLocalStorage TenantContext for the lifetime of each request (ADR-0004). Tenant
 * isolation is structural: any tenant-owned data access with no open context throws, so this
 * middleware MUST run before any controller that reads tenant data.
 *
 * Resolution order: self-host uses the single configured tenant; hosted derives the tenant from
 * the Host header. An unresolvable host is rejected (404) rather than silently defaulting to a
 * tenant — guessing here would be a cross-dojo leak.
 *
 * CROSS-CHECK STUB: once auth middleware populates a verified access token, this must assert that
 * `token.tenantId === resolvedTenant` (a membership for the resolved tenant), per ADR-0004 — the
 * resolved REQUEST tenant wins, never the token's tenantId alone. Auth is not wired yet, so the
 * userId/roles below are placeholders and the equality check is a TODO, not yet enforced.
 */
@Injectable()
export class TenancyMiddleware implements NestMiddleware {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const resolved = resolveTenantFromHost(this.config, req.headers.host);
    if (resolved === null) {
      res.status(404).json({ error: 'unknown_tenant' });
      return;
    }

    // STUB: until the data layer resolves slug → TenantId, brand the slug as the id placeholder.
    const tenantId = brand<TenantId>(resolved.slug);
    // STUB: auth not wired — anonymous principal until the token guard populates it.
    const userId: UserId | null = null;

    const context: TenantContext = {
      tenantId,
      userId,
      sessionId: null,
      roles: [],
      locationScope: 'ALL',
      requestId: requestIdOf(req),
      tenancy: this.config.tenancy,
    };

    // TODO(auth): assert token.tenantId resolves to `tenantId` here before proceeding (ADR-0004).
    runInTenantContext(context, () => {
      next();
    });
  }
}

/** Reuse an upstream request id if a trusted proxy set one, else mint a fresh one. */
function requestIdOf(req: Request): string {
  const header = req.headers['x-request-id'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (typeof fromHeader === 'string' && fromHeader.length > 0) return fromHeader;
  return randomUUID();
}
