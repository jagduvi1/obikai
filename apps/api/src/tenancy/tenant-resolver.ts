import type { AppConfig } from '@obikai/config';

/**
 * Resolves which dojo a request belongs to BEFORE any tenant-owned data is touched.
 *
 * - self-host (`tenancy === 'single'`): always the single configured tenant slug. The Host header
 *   is irrelevant — a self-host serves exactly one dojo.
 * - hosted (`tenancy === 'multi'`): the leftmost label of the Host header relative to baseDomain
 *   (e.g. `kodokan.obikai.app` → `kodokan`). The apex/`www` and unknown hosts resolve to null so
 *   the caller can reject rather than guess a tenant.
 */
export interface ResolvedTenant {
  /** The tenant slug (NOT yet a TenantId — that lookup happens in the data layer). */
  readonly slug: string;
}

export function resolveTenantFromHost(
  config: AppConfig,
  hostHeader: string | undefined,
): ResolvedTenant | null {
  if (config.tenancy === 'single') {
    const slug = config.selfHostTenantSlug;
    return slug !== null ? { slug } : null;
  }

  const host = normalizeHost(hostHeader);
  if (host === null) return null;

  const slug = subdomainOf(host, config.baseDomain);
  return slug !== null ? { slug } : null;
}

/** Strip a trailing port and lowercase. Returns null for an empty/missing header. */
function normalizeHost(hostHeader: string | undefined): string | null {
  if (hostHeader === undefined) return null;
  const trimmed = hostHeader.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  const colon = trimmed.indexOf(':');
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

/** Return the single leftmost label of `host` under `baseDomain`, or null if it is the apex,
 * `www`, a multi-label subdomain, or not under baseDomain at all. */
function subdomainOf(host: string, baseDomain: string): string | null {
  const base = baseDomain.toLowerCase();
  if (host === base) return null;
  const suffix = `.${base}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, host.length - suffix.length);
  if (label.length === 0 || label === 'www' || label.includes('.')) return null;
  return label;
}
