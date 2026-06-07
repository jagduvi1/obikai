/**
 * @obikai/adapter-vat — VatValidationPort implementations (ADR-0025).
 *  - `none`: the offline/self-host default. Performs NO network check; always reports `unavailable`
 *    (existence unverified), so callers fall back to the offline format check.
 *  - `vies`: the EU VIES REST service. The critical behaviour is the three-state mapping: VIES
 *    returns HTTP 200 even when it cannot answer, so only an explicit `valid:false, userError:INVALID`
 *    is treated as `invalid`; every transient/blocked/unknown condition is `unavailable`, NEVER
 *    `invalid`. No vendor SDK — uses the runtime `fetch` (injectable for tests).
 */
import type {
  AdapterContext,
  HealthStatus,
  VatCheckInput,
  VatCheckResult,
  VatValidationCapability,
  VatValidationPort,
} from '@obikai/adapter-contracts';

const CAPABILITIES: ReadonlySet<VatValidationCapability> = new Set<VatValidationCapability>([
  'check',
]);

/** Default real VIES REST endpoint (POST {countryCode, vatNumber}). Overridable via config. */
export const VIES_DEFAULT_BASE_URL =
  'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';

/** VIES `userError` codes that mean the number is DEFINITIVELY not registered (everything else that
 *  isn't `valid:true` is treated as a transient/unknown failure → `unavailable`). */
const DEFINITIVELY_INVALID = new Set(['INVALID', 'INVALID_INPUT']);

/** Minimal HTTP surface so the adapter is testable without a real network / DOM Response type. */
export interface VatHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}
export type VatHttp = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<VatHttpResponse>;

const defaultHttp: VatHttp = async (url, init) => {
  const fetchFn = (
    globalThis as unknown as {
      fetch: (u: string, i: unknown) => Promise<VatHttpResponse>;
    }
  ).fetch;
  return fetchFn(url, init);
};

interface ViesBody {
  valid?: boolean;
  userError?: string;
  name?: string;
  address?: string;
  requestIdentifier?: string;
  requestDate?: string;
}

/** VIES returns '---' or '' for names/addresses member states don't disclose; normalize to null. */
function cleanField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed === '---' ? null : trimmed;
}

const NULLS = { name: null, address: null, requestIdentifier: null } as const;

/** The offline default: never contacts a network; reports existence as unverified (`unavailable`). */
export class NoneVatProvider implements VatValidationPort {
  readonly kind = 'vat' as const;
  readonly providerId = 'none';
  readonly capabilities = CAPABILITIES;

  constructor(private readonly ctx: AdapterContext) {}

  init(): Promise<void> {
    return Promise.resolve();
  }
  dispose(): Promise<void> {
    return Promise.resolve();
  }
  health(): Promise<HealthStatus> {
    return Promise.resolve({ ok: true });
  }

  check(_input: VatCheckInput): Promise<VatCheckResult> {
    return Promise.resolve({
      status: 'unavailable',
      ...NULLS,
      checkedAt: this.ctx.clock().toISOString(),
      source: this.providerId,
    });
  }
}

export interface ViesParams {
  readonly baseUrl: string;
}

/** EU VIES REST validator. Maps VIES's HTTP-200-always responses to the three-state result. */
export class ViesVatProvider implements VatValidationPort {
  readonly kind = 'vat' as const;
  readonly providerId = 'vies';
  readonly capabilities = CAPABILITIES;

  constructor(
    private readonly params: ViesParams,
    private readonly ctx: AdapterContext,
    private readonly http: VatHttp = defaultHttp,
  ) {}

  init(): Promise<void> {
    return Promise.resolve();
  }
  dispose(): Promise<void> {
    return Promise.resolve();
  }
  /** Do NOT probe VIES on healthchecks (it is rate-limited and routinely flaky per member state). */
  health(): Promise<HealthStatus> {
    return Promise.resolve({ ok: true });
  }

  async check(input: VatCheckInput): Promise<VatCheckResult> {
    const checkedAt = this.ctx.clock().toISOString();
    let body: ViesBody;
    try {
      const res = await this.http(this.params.baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ countryCode: input.countryCode, vatNumber: input.number }),
      });
      if (!res.ok) {
        return { status: 'unavailable', ...NULLS, checkedAt, source: this.providerId };
      }
      // res.json() can resolve to null/undefined/a primitive (empty body, a proxy returning literal
      // `null`) WITHOUT throwing — guard before dereferencing so it maps to `unavailable`, not a crash.
      const parsed = (await res.json()) as unknown;
      if (parsed === null || typeof parsed !== 'object') {
        return { status: 'unavailable', ...NULLS, checkedAt, source: this.providerId };
      }
      body = parsed as ViesBody;
    } catch (cause) {
      this.ctx.logger.warn('vies check failed', {
        error: cause instanceof Error ? cause.message : String(cause),
      });
      return { status: 'unavailable', ...NULLS, checkedAt, source: this.providerId };
    }

    if (body.valid === true) {
      return {
        status: 'valid',
        name: cleanField(body.name),
        address: cleanField(body.address),
        requestIdentifier: cleanField(body.requestIdentifier),
        checkedAt: cleanField(body.requestDate) ?? checkedAt,
        source: this.providerId,
      };
    }
    if (typeof body.userError === 'string' && DEFINITIVELY_INVALID.has(body.userError)) {
      return { status: 'invalid', ...NULLS, checkedAt, source: this.providerId };
    }
    // Not valid, and not an explicit INVALID → service/member-state down, timeout, rate-limited,
    // blocked, or an unrecognized code. Treat as UNAVAILABLE, never invalid.
    return { status: 'unavailable', ...NULLS, checkedAt, source: this.providerId };
  }
}
