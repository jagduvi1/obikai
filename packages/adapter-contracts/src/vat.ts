import type { Adapter } from './base.js';

/**
 * VAT-number existence validation port (ADR-0025). The authoritative "is this VAT number actually
 * registered?" check — distinct from the offline format check in `@obikai/domain`. Backed by the EU
 * VIES service (or a no-op for offline/self-host). Optional + feature-flagged: the product works
 * fully with it disabled (invariant 4 posture for external services).
 */

export type VatValidationCapability = 'check';

/**
 * THREE-state result — the crucial distinction (VIES returns HTTP 200 even when it cannot answer):
 *  - `valid`       — the number is registered.
 *  - `invalid`     — the number is definitively NOT registered (VIES `userError: INVALID`).
 *  - `unavailable` — the lookup could not be completed (service/member-state down, timeout, rate
 *                    limit, blocked, or the provider is disabled). NEVER treat this as `invalid`.
 */
export type VatCheckStatus = 'valid' | 'invalid' | 'unavailable';

/** The 2-letter member-state code (e.g. `SE`, `EL` for Greece) + the number part WITHOUT the prefix. */
export interface VatCheckInput {
  readonly countryCode: string;
  readonly number: string;
}

export interface VatCheckResult {
  readonly status: VatCheckStatus;
  /** Registered trader name, when the member state discloses it (often null even when valid). */
  readonly name: string | null;
  readonly address: string | null;
  /** VIES consultation reference (proof-of-check), when available; null otherwise. */
  readonly requestIdentifier: string | null;
  /** ISO timestamp of the check. */
  readonly checkedAt: string;
  /** Which provider answered (e.g. `vies`, `none`). */
  readonly source: string;
}

export interface VatValidationPort extends Adapter<VatValidationCapability> {
  readonly kind: 'vat';
  check(input: VatCheckInput): Promise<VatCheckResult>;
}
