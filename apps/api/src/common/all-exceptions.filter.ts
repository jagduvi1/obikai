import { randomUUID } from 'node:crypto';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import { getTenantContextOrThrow } from '@obikai/db';
import type { Request, Response } from 'express';
import { jsonLine } from './logging.js';

/**
 * Global exception filter (audit F2). Without it, any unmapped error (a Mongo timeout, a null deref,
 * an adapter failure) falls through to a bare 500 with no structured log, request id, or tenant
 * context — the biggest "know when it's broken" gap.
 *
 * - Known `HttpException`s pass through UNCHANGED (4xx client errors stay quiet); 5xx are logged.
 * - Anything else becomes a generic 500 whose body leaks NOTHING (no message/stack to the client) —
 *   the full detail is logged server-side, correlatable by the `x-request-id` returned to the caller.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();
    const requestId = randomUUID();
    res.setHeader('x-request-id', requestId);

    // Best-effort tenant/actor correlation (context may be absent for pre-auth/early failures).
    let tenantId: string | undefined;
    let userId: string | null | undefined;
    try {
      const ctx = getTenantContextOrThrow();
      tenantId = ctx.tenantId;
      userId = ctx.userId;
    } catch {
      // no active tenant context — fine.
    }
    const base = {
      requestId,
      method: req.method,
      path: req.originalUrl ?? req.url,
      tenantId,
      userId,
    };

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) {
        jsonLine('error', 'request failed', { ...base, status, error: exception.message });
      }
      const body = exception.getResponse();
      res
        .status(status)
        .json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }

    // Unmapped error → 500. Log everything; return nothing sensitive.
    jsonLine('error', 'unhandled exception', {
      ...base,
      status: 500,
      error: exception instanceof Error ? exception.message : String(exception),
      stack: exception instanceof Error ? exception.stack : undefined,
    });
    res.status(500).json({ statusCode: 500, message: 'Internal server error', requestId });
  }
}
