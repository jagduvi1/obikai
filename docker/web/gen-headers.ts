/**
 * gen-headers.ts — the TypeScript source-of-truth for the SPA's Content-Security-Policy
 * and security headers, and the renderer that emits the final Caddyfile from the template.
 *
 * WHY THIS FILE EXISTS (ADR-0008 boundary / compensating control):
 * Invariant 8 says all *application and business logic* is TypeScript. The edge (Caddy) and
 * proxy (Traefik) are conventional infra and exempt — EXCEPT the one security-relevant config
 * they consume, the CSP + security headers, which must be GENERATED FROM A TS SOURCE-OF-TRUTH
 * AND TESTED, never hand-authored in raw Caddy syntax. This file is that compensating control:
 * the header strings are built here (unit-testable via `buildSecurityHeaders`), then injected
 * into `Caddyfile.template`'s placeholders to produce the served `Caddyfile`.
 *
 * Standalone TS, run via tsx (no package.json/build step needed for the scaffold), e.g.:
 *   ALLOWED_CONNECT_ORIGINS="https://api.example.com" \
 *   tsx docker/web/gen-headers.ts docker/web/Caddyfile.template docker/web/Caddyfile
 *
 * It depends on Node built-ins only (node:fs, node:process) — no third-party runtime deps.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

/** Inputs that vary per deployment; everything else is a hardened constant below. */
export interface HeaderOptions {
  /** Extra origins the SPA may `fetch`/`connect` to (the API, WebSocket, S3/MinIO). */
  readonly connectOrigins: readonly string[];
  /** Extra origins images may load from (e.g. an S3/CDN bucket for member photos). */
  readonly imgOrigins: readonly string[];
  /** Extra origins fonts may load from. */
  readonly fontOrigins: readonly string[];
}

/** Join `'self'` with any caller-supplied origins, de-duplicated and space-separated. */
function sources(...origins: readonly string[]): string {
  const all = ["'self'", ...origins.filter((o) => o.length > 0)];
  return [...new Set(all)].join(' ');
}

/**
 * Build the Content-Security-Policy value. Deliberately strict: no inline script, no eval,
 * object-src none, base-uri/form-action self, frame-ancestors none (clickjacking). A modern
 * Vite SPA needs no 'unsafe-inline' for scripts; styles allow inline only (hashed-asset CSS
 * plus the occasional inline style attribute is unavoidable for some component libraries).
 */
export function buildCsp(opts: HeaderOptions): string {
  const directives: Record<string, string> = {
    'default-src': "'self'",
    'script-src': "'self'",
    'style-src': sources("'unsafe-inline'"),
    'img-src': sources('data:', 'blob:', ...opts.imgOrigins),
    'font-src': sources('data:', ...opts.fontOrigins),
    'connect-src': sources(...opts.connectOrigins),
    'object-src': "'none'",
    'base-uri': "'self'",
    'form-action': "'self'",
    'frame-ancestors': "'none'",
    'manifest-src': "'self'",
    'worker-src': sources('blob:'),
    'upgrade-insecure-requests': '',
  };
  return Object.entries(directives)
    .map(([k, v]) => (v.length > 0 ? `${k} ${v}` : k))
    .join('; ');
}

/**
 * The full set of security response headers, as an ordered name→value map. Tested in TS so a
 * regression (a dropped HSTS, a loosened CSP) fails a unit test rather than shipping silently.
 */
export function buildSecurityHeaders(opts: HeaderOptions): ReadonlyMap<string, string> {
  return new Map<string, string>([
    ['Content-Security-Policy', buildCsp(opts)],
    ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload'],
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()'],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
    ['Cross-Origin-Resource-Policy', 'same-origin'],
    ['X-Permitted-Cross-Domain-Policies', 'none'],
  ]);
}

/** Render the header map into Caddy `header` directive lines (2-space body indent). */
export function renderCaddyHeaderBlock(headers: ReadonlyMap<string, string>): string {
  const lines: string[] = [];
  for (const [name, value] of headers) {
    lines.push(`\t\t${name} "${value}"`);
  }
  // Caddy hides the server banner via `-Server`; keep it adjacent to the set headers.
  lines.push('\t\t-Server');
  return lines.join('\n');
}

/** Parse a comma/space separated env var into a trimmed, non-empty origin list. */
function parseOrigins(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Read deployment options from the environment (set by compose / CI). */
export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): HeaderOptions {
  return {
    connectOrigins: parseOrigins(env.ALLOWED_CONNECT_ORIGINS),
    imgOrigins: parseOrigins(env.ALLOWED_IMG_ORIGINS),
    fontOrigins: parseOrigins(env.ALLOWED_FONT_ORIGINS),
  };
}

/**
 * Render a Caddyfile by substituting placeholders in the template:
 *   {{SECURITY_HEADERS}} → the generated header block
 *   {{SITE_ADDRESS}}     → env SITE_ADDRESS (default ':8080' for container-local serving)
 */
export function renderCaddyfile(
  template: string,
  opts: HeaderOptions,
  siteAddress: string,
): string {
  const headerBlock = renderCaddyHeaderBlock(buildSecurityHeaders(opts));
  return template
    .replaceAll('{{SECURITY_HEADERS}}', headerBlock)
    .replaceAll('{{SITE_ADDRESS}}', siteAddress);
}

/** CLI entry: `tsx gen-headers.ts <template> <output>`. */
function main(): void {
  const [, , templatePath, outputPath] = process.argv;
  if (!templatePath || !outputPath) {
    process.stderr.write('usage: tsx gen-headers.ts <template> <output>\n');
    process.exitCode = 1;
    return;
  }
  const template = readFileSync(templatePath, 'utf8');
  const opts = optionsFromEnv();
  const siteAddress = process.env.SITE_ADDRESS ?? ':8080';
  writeFileSync(outputPath, renderCaddyfile(template, opts, siteAddress), 'utf8');
}

// Only run as a script, not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
