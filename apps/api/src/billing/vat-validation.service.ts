import type { VatCheckResult, VatValidationPort } from '@obikai/adapter-contracts';
import { type AuthzActor, can } from '@obikai/authz';
import { type VatFormatResult, validateVatFormat } from '@obikai/domain';

/**
 * VatValidationService (ADR-0025). Two-stage validation of a VAT id: the offline FORMAT check
 * (pure @obikai/domain) first, then — only if well-formed — the authoritative EXISTENCE check via the
 * VatValidationPort (VIES or the no-op). Framework-free for unit-testing; gated on `tenantSettings`
 * (owner/staff do billing setup). Never blocks on a VIES outage: the port returns `unavailable`.
 */
export class ForbiddenError extends Error {
  constructor(action: string, resource: string) {
    super(`forbidden: ${action} on ${resource}`);
    this.name = 'ForbiddenError';
  }
}

export interface VatValidationResult {
  readonly input: string;
  readonly format: VatFormatResult;
  /** The existence check, or null when the format is invalid (a VIES call would be pointless). */
  readonly check: VatCheckResult | null;
}

export class VatValidationService {
  constructor(private readonly port: VatValidationPort) {}

  async validate(actor: AuthzActor, vatId: string): Promise<VatValidationResult> {
    if (!can(actor, { resource: 'tenantSettings', action: 'read' })) {
      throw new ForbiddenError('read', 'tenantSettings');
    }
    const format = validateVatFormat(vatId);
    if (!format.ok || format.countryCode === null || format.number === null) {
      return { input: vatId, format, check: null };
    }
    const check = await this.port.check({ countryCode: format.countryCode, number: format.number });
    return { input: vatId, format, check };
  }
}
