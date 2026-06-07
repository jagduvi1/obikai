import type { ArgumentsHost } from '@nestjs/common';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

/** Minimal Express res capture + ArgumentsHost stub (the filter only uses switchToHttp). */
function fakeRes() {
  const captured = { status: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(s: number) {
      captured.status = s;
      return res;
    },
    json(b: unknown) {
      captured.body = b;
      return res;
    },
    setHeader(k: string, v: string) {
      captured.headers[k] = v;
    },
  };
  return { res, captured };
}
const host = (res: unknown): ArgumentsHost =>
  ({
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ method: 'GET', url: '/x', originalUrl: '/x' }),
    }),
  }) as ArgumentsHost;

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('passes a known HttpException through unchanged + sets x-request-id', () => {
    const { res, captured } = fakeRes();
    filter.catch(new NotFoundException('member not found'), host(res));
    expect(captured.status).toBe(404);
    expect(captured.body).toMatchObject({ statusCode: 404, message: 'member not found' });
    expect(captured.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
  });

  it('preserves a 4xx with a non-string (validation) body', () => {
    const { res, captured } = fakeRes();
    filter.catch(new ForbiddenException({ statusCode: 403, message: ['bad'] }), host(res));
    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({ message: ['bad'] });
  });

  it('turns an unmapped error into a generic 500 that leaks nothing (id correlates to logs)', () => {
    const { res, captured } = fakeRes();
    filter.catch(new Error('secret db detail: user a@b.co'), host(res));
    expect(captured.status).toBe(500);
    expect(captured.body).toMatchObject({ statusCode: 500, message: 'Internal server error' });
    // No internal detail leaks to the client...
    expect(JSON.stringify(captured.body)).not.toContain('a@b.co');
    // ...but the response carries the request id that the server-side log records.
    expect((captured.body as { requestId: string }).requestId).toBe(
      captured.headers['x-request-id'],
    );
  });
});
