import { Injectable, type NestMiddleware } from '@nestjs/common';
import { PlatformGrantRepository, runAsPlatform } from '@obikai/db';
import type { NextFunction, Request, Response } from 'express';
import { TokenService } from '../auth/token.service.js';
import { type PlatformRequest, decidePlatformAccess } from './platform-access.js';

/**
 * Opens the explicit cross-tenant scope for `/platform/*` (ADR-0021/0022). Unlike TenancyMiddleware
 * it resolves NO tenant: it authenticates the user from the access token (tenant-independent JWT,
 * ADR-0012), requires a `PlatformGrant`, then runs the whole request under `runAsPlatform(...)` so
 * platform-aware repositories (e.g. the tenant registry) work and tenant-scoped ones stay refused.
 * The grant lookup runs BEFORE any context exists — `PlatformGrant` is tenant-global, so that is safe
 * (ADR-0021). Routes under `/platform` are excluded from TenancyMiddleware so the two never overlap.
 */
@Injectable()
export class PlatformMiddleware implements NestMiddleware {
  constructor(
    private readonly tokens: TokenService,
    private readonly grants: PlatformGrantRepository,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const claims = await this.verify(req);
    const grant = claims ? await this.grants.findByUserId(claims.userId) : null;
    const access = decidePlatformAccess(claims, grant);
    if (access.kind === 'unauthenticated') {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    if (access.kind === 'forbidden') {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    (req as PlatformRequest).platformActor = access.actor;
    runAsPlatform(() => next());
  }

  private async verify(req: Request): Promise<{ userId: string; sessionId: string } | null> {
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    return this.tokens.verifyAccess(header.slice('Bearer '.length).trim());
  }
}
