import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { AppConfig } from '@obikai/config';
import { type MembershipRepository, type TenantContext, runInTenantContext } from '@obikai/db';
import { type RoleAssignment, type TenantId, brand } from '@obikai/domain';
import type { NextFunction, Request, Response } from 'express';
import type { TokenService } from '../auth/token.service.js';
import { APP_CONFIG } from '../config.provider.js';
import { resolveTenantFromHost } from './tenant-resolver.js';

/**
 * Opens an AsyncLocalStorage TenantContext for each request (ADR-0004/0012). Resolution order:
 *  1. Resolve the request tenant from the Host (self-host: the single tenant). Unknown host → 404.
 *  2. Verify the access token (if any) → the acting userId + sessionId.
 *  3. Load the user's Membership for the RESOLVED tenant → roles + memberId. The RESOLVED tenant
 *     always wins; the token never carries roles (ADR-0012). No/!active membership ⇒ role-less ⇒
 *     can() denies (safe default).
 * Tenant isolation is structural: any tenant-owned access with no open context throws.
 */
@Injectable()
export class TenancyMiddleware implements NestMiddleware {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tokens: TokenService,
    private readonly memberships: MembershipRepository,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const resolved = resolveTenantFromHost(this.config, req.headers.host);
    if (resolved === null) {
      res.status(404).json({ error: 'unknown_tenant' });
      return;
    }
    const tenantId = brand<TenantId>(resolved.slug);

    let userId: string | null = null;
    let sessionId: string | null = null;
    let roles: readonly RoleAssignment[] = [];
    let memberId: string | null = null;

    const claims = await this.verify(req);
    if (claims) {
      userId = claims.userId;
      sessionId = claims.sessionId;
      const membership = await this.memberships.resolveForRequest(resolved.slug, userId);
      if (membership && membership.status === 'active') {
        roles = membership.roles;
        memberId = membership.memberId;
      }
    }

    const context: TenantContext = {
      tenantId,
      userId,
      sessionId,
      roles,
      memberId,
      requestId: requestIdOf(req),
      tenancy: this.config.tenancy,
    };
    runInTenantContext(context, () => next());
  }

  private async verify(req: Request): Promise<{ userId: string; sessionId: string } | null> {
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    return this.tokens.verifyAccess(header.slice('Bearer '.length).trim());
  }
}

/** Reuse an upstream request id if a trusted proxy set one, else mint a fresh one. */
function requestIdOf(req: Request): string {
  const header = req.headers['x-request-id'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (typeof fromHeader === 'string' && fromHeader.length > 0) return fromHeader;
  return randomUUID();
}
