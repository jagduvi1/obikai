#!/usr/bin/env node
// @ts-check
/**
 * Obikai deny-by-default license gate (ADR-0008).
 *
 * Obikai is AGPL-3.0-or-later; every dependency must be AGPL-compatible. This script
 * walks the production dependency closure of the whole workspace and FAILS CLOSED on any
 * license that is not on the explicit SPDX allowlist below — and on any dependency whose
 * license we cannot determine.
 *
 * Built-ins only (no third-party deps), so it can run in CI before/without a full install
 * of dev tooling.
 *
 * Primary source: `pnpm licenses list --json --prod`. pnpm's output shape has changed
 * across versions (it has been emitted both as `{ "<license>": [pkg, ...] }` and as an
 * array of `{ name, license/licenses, ... }`); both are handled. If pnpm is unavailable or
 * emits an unrecognized shape we fail closed with a clear message rather than passing
 * silently.
 *
 * Run: `node scripts/license-check.mjs`  (wired as `pnpm license:check`).
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

/**
 * SPDX identifiers we accept. Mirrors ADR-0008 exactly. `AGPL-3.0` / `AGPL-3.0-or-later`
 * cover our own first-party packages; the rest are permissive or AGPL-compatible weak
 * copyleft (MPL-2.0 is dev/test-only, never bundled — see ADR-0008).
 */
const ALLOWLIST = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  // Zlib: permissive, FSF-certified GPL/AGPL-compatible. Arrives via `pako` (SPDX
  // "MIT AND Zlib") under `pdf-lib` (invoice PDF rendering, ADR-0013/0018).
  'Zlib',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'MPL-2.0',
  'AGPL-3.0-or-later',
  'AGPL-3.0',
]);

/**
 * Packages excluded from the gate by deliberate, documented exception. Keys are bare
 * package names (no version). Keep this set SMALL and justify every entry with an
 * ADR/comment — each one is a hole in a fail-closed gate.
 *
 * @type {Map<string, string>}
 */
const EXCLUDE_PACKAGES = new Map([
  // mongodb-memory-server is MIT itself, but its postinstall downloads SSPL Mongo binaries
  // that the npm-metadata checker cannot see; accepted as a test-only external service
  // (ADR-0008). Listed defensively in case a future transitive license string trips.
  // 'mongodb-memory-server': 'ADR-0008: test-only external service',
]);

/**
 * Some published packages carry an unfortunate or non-normalized SPDX string for a license
 * that is in fact on our allowlist (e.g. legacy `BSD`, `Apache 2.0`, `MIT*`). We normalize
 * a few well-known spellings rather than widen the allowlist. Anything not mapped here and
 * not already an exact allowlist member fails.
 *
 * @type {Record<string, string>}
 */
const NORMALIZE = {
  BSD: 'BSD-3-Clause',
  'BSD-like': 'BSD-3-Clause',
  'Apache 2.0': 'Apache-2.0',
  'Apache2.0': 'Apache-2.0',
  'Apache License 2.0': 'Apache-2.0',
  'MIT*': 'MIT',
  'MIT License': 'MIT',
  'CC-BY-3.0': 'CC-BY-3.0', // intentionally NOT on allowlist — keep explicit so it still fails
};

/**
 * Decide whether a (possibly compound) SPDX expression is acceptable.
 *
 * We accept an OR expression if ANY operand is allowed (consumer may pick the allowed
 * license), and an AND expression only if EVERY operand is allowed (all apply). Parentheses
 * are flattened conservatively: we only special-case the common simple forms and otherwise
 * tokenize on the operators, which is sufficient for the licenses real packages publish.
 *
 * @param {string} raw
 * @returns {{ ok: boolean, normalized: string }}
 */
function isLicenseAllowed(raw) {
  const expr = (raw ?? '').trim();
  if (expr === '' || expr.toLowerCase() === 'unknown' || expr.toLowerCase() === 'unlicensed') {
    return { ok: false, normalized: expr === '' ? '(none)' : expr };
  }

  const cleaned = expr.replace(/[()]/g, ' ').trim();

  const orParts = cleaned.split(/\s+OR\s+/i).map((p) => p.trim());
  if (orParts.length > 1) {
    for (const part of orParts) {
      if (isLicenseAllowed(part).ok) {
        return { ok: true, normalized: part };
      }
    }
    return { ok: false, normalized: expr };
  }

  const andParts = cleaned.split(/\s+AND\s+/i).map((p) => p.trim());
  if (andParts.length > 1) {
    const normalizedAll = andParts.map((p) => NORMALIZE[p] ?? p);
    const ok = normalizedAll.every((p) => ALLOWLIST.has(p));
    return { ok, normalized: normalizedAll.join(' AND ') };
  }

  const single = NORMALIZE[cleaned] ?? cleaned;
  return { ok: ALLOWLIST.has(single), normalized: single };
}

/**
 * Run `pnpm licenses list --json --prod` and return parsed JSON, or throw a descriptive
 * error. We try the modern invocation and fall back to a `--long` form on older pnpm.
 *
 * @returns {unknown}
 */
function runPnpmLicenses() {
  const attempts = [
    ['licenses', 'list', '--json', '--prod'],
    ['licenses', 'ls', '--json', '--prod'],
  ];

  /** @type {string | null} */
  let lastErr = null;
  for (const args of attempts) {
    const res = spawnSync('pnpm', args, {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.error) {
      lastErr = res.error.message;
      continue;
    }
    const stdout = (res.stdout ?? '').trim();
    // pnpm exits non-zero when it has nothing to report on some versions; only treat as
    // fatal if we also got no usable JSON.
    if (stdout.length > 0) {
      try {
        return JSON.parse(stdout);
      } catch (e) {
        lastErr = `could not parse JSON from \`pnpm ${args.join(' ')}\`: ${
          e instanceof Error ? e.message : String(e)
        }`;
        continue;
      }
    }
    if (res.status === 0) {
      // Empty but successful — no production deps to report.
      return {};
    }
    lastErr = `\`pnpm ${args.join(' ')}\` exited ${res.status}: ${(res.stderr ?? '').trim()}`;
  }
  throw new Error(lastErr ?? 'failed to invoke pnpm licenses');
}

/**
 * Normalize either pnpm output shape into a flat list of dependency records.
 *
 * Shape A (object keyed by license):
 *   { "MIT": [ { name, versions, ... }, ... ], "ISC": [ ... ] }
 * Shape B (flat array):
 *   [ { name, license | licenses, versions | version, ... }, ... ]
 *
 * @param {unknown} data
 * @returns {Array<{ name: string, license: string, versions: string[] }>}
 */
function normalizeRecords(data) {
  /** @type {Array<{ name: string, license: string, versions: string[] }>} */
  const out = [];

  /** @param {any} entry @param {string} [licenseFromKey] */
  const push = (entry, licenseFromKey) => {
    if (entry == null || typeof entry !== 'object') return;
    const name = typeof entry.name === 'string' ? entry.name : String(entry.name ?? 'unknown');
    const license =
      licenseFromKey ??
      (typeof entry.license === 'string'
        ? entry.license
        : typeof entry.licenses === 'string'
          ? entry.licenses
          : Array.isArray(entry.licenses)
            ? entry.licenses.join(' AND ')
            : 'unknown');
    const versions = Array.isArray(entry.versions)
      ? entry.versions.map((v) => String(v))
      : entry.version != null
        ? [String(entry.version)]
        : [];
    out.push({ name, license, versions });
  };

  if (Array.isArray(data)) {
    for (const entry of data) push(entry);
  } else if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value)) {
        for (const entry of value) push(entry, key);
      } else {
        push(value, key);
      }
    }
  } else {
    throw new Error('unrecognized `pnpm licenses` output shape (expected object or array)');
  }

  return out;
}

function main() {
  let raw;
  try {
    raw = runPnpmLicenses();
  } catch (e) {
    process.stderr.write(
      `license-check: FAILED to obtain license data (failing closed).\n  ${
        e instanceof Error ? e.message : String(e)
      }\n`,
    );
    process.exit(1);
    return;
  }

  /** @type {Array<{ name: string, license: string, versions: string[] }>} */
  let records;
  try {
    records = normalizeRecords(raw);
  } catch (e) {
    process.stderr.write(
      `license-check: FAILED to parse license data (failing closed).\n  ${
        e instanceof Error ? e.message : String(e)
      }\n`,
    );
    process.exit(1);
    return;
  }

  /** @type {Array<{ name: string, license: string, normalized: string, versions: string[] }>} */
  const violations = [];
  /** @type {Array<{ name: string, license: string }>} */
  const excluded = [];
  /** @type {Map<string, number>} */
  const allowedByLicense = new Map();

  for (const rec of records) {
    if (EXCLUDE_PACKAGES.has(rec.name)) {
      excluded.push({ name: rec.name, license: rec.license });
      continue;
    }
    const { ok, normalized } = isLicenseAllowed(rec.license);
    if (ok) {
      allowedByLicense.set(normalized, (allowedByLicense.get(normalized) ?? 0) + 1);
    } else {
      violations.push({
        name: rec.name,
        license: rec.license,
        normalized,
        versions: rec.versions,
      });
    }
  }

  const lines = [];
  lines.push('Obikai license gate (ADR-0008) — deny-by-default over the --prod closure');
  lines.push(`  packages scanned : ${records.length}`);
  lines.push(`  allowed licenses : ${[...allowedByLicense.keys()].sort().join(', ') || '(none)'}`);
  if (excluded.length > 0) {
    lines.push(`  excluded (waived): ${excluded.map((e) => e.name).join(', ')}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);

  if (violations.length > 0) {
    const report = violations
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((v) => {
        const ver = v.versions.length > 0 ? `@${v.versions.join(',')}` : '';
        return `  - ${v.name}${ver}: '${v.license}' (not on allowlist)`;
      })
      .join('\n');
    process.stderr.write(
      `\nlicense-check: FAILED — ${violations.length} dependency license(s) not allowed:\n${report}\n\nFix by removing/replacing the dependency, or — if it is genuinely AGPL-compatible\nand the SPDX id is missing from the allowlist — update ADR-0008 and this script\ntogether. To waive a specific package, add it to EXCLUDE_PACKAGES with a reason.\n`,
    );
    process.exit(1);
    return;
  }

  process.stdout.write('license-check: PASS — all production dependencies are AGPL-compatible.\n');
  process.exit(0);
}

main();
