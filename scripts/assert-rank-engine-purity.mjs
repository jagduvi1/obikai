#!/usr/bin/env node
// @ts-check
/**
 * Independent guard for the rank-engine purity + AI-exclusion invariant (ADR-0003, ADR-0005).
 *
 * `@obikai/rank-engine` is a pure, deterministic, framework/DB-agnostic package whose ENTIRE
 * dependency surface is `@obikai/domain` plus a handful of pure math/util libraries. AI must
 * be structurally incapable of entering the rank-decision path.
 *
 * ESLint (`eslint-plugin-boundaries`) already enforces this at the import level. This script
 * is the SECOND, independent check the ADRs require, so a single ESLint misconfiguration
 * cannot quietly open the seam: it reads the rank-engine's declared dependency closure and
 * fails (exit 1) if it finds
 *   (a) any package whose name matches the forbidden DB/framework/AI denylist, or
 *   (b) any `@obikai/*` workspace dependency OTHER than `@obikai/domain`.
 *
 * Built-ins only (no third-party deps). Run: `node scripts/assert-rank-engine-purity.mjs`
 * (wired as `pnpm verify:purity`).
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const RANK_ENGINE_PKG = join(REPO_ROOT, 'packages', 'rank-engine', 'package.json');

/**
 * Forbidden package-name pattern: any DB driver, server framework, queue/cache client,
 * cloud SDK, or AI client must NEVER appear in the engine's closure. Matched against the
 * bare dependency name (case-insensitive).
 */
const FORBIDDEN = /anthropic|openai|ollama|mongoose|@nestjs|express|bullmq|ioredis|aws-sdk/i;

/** The only `@obikai/*` dependency the engine is permitted to have. */
const ALLOWED_OBIKAI = new Set(['@obikai/domain']);

/**
 * @param {string} file
 * @returns {Record<string, unknown>}
 */
function readJson(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`cannot parse ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Collect dependency names from the runtime-relevant dependency fields. `dependencies` and
 * `peerDependencies` + `optionalDependencies` are part of the shipped closure; we
 * intentionally also inspect them all because any of them can pull code into the engine's
 * runtime graph. devDependencies are excluded — they are not part of the shipped engine.
 *
 * @param {Record<string, unknown>} pkg
 * @returns {string[]}
 */
function runtimeDependencyNames(pkg) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const block = pkg[field];
    if (block && typeof block === 'object') {
      for (const name of Object.keys(block)) names.add(name);
    }
  }
  return [...names].sort();
}

function main() {
  /** @type {Record<string, unknown>} */
  let pkg;
  try {
    pkg = readJson(RANK_ENGINE_PKG);
  } catch (e) {
    process.stderr.write(
      `assert-rank-engine-purity: FAILED (failing closed).\n  ${
        e instanceof Error ? e.message : String(e)
      }\n`,
    );
    process.exit(1);
    return;
  }

  const deps = runtimeDependencyNames(pkg);

  /** @type {string[]} */
  const violations = [];
  for (const name of deps) {
    if (FORBIDDEN.test(name)) {
      violations.push(`${name}: matches forbidden DB/framework/AI pattern`);
      continue;
    }
    if (name.startsWith('@obikai/') && !ALLOWED_OBIKAI.has(name)) {
      violations.push(`${name}: rank-engine may depend only on @obikai/domain (ADR-0003)`);
    }
  }

  process.stdout.write(
    `assert-rank-engine-purity (ADR-0003/0005) — packages/rank-engine\n  runtime deps scanned: ${deps.length}\n  deps: ${deps.join(', ') || '(none)'}\n`,
  );

  if (violations.length > 0) {
    process.stderr.write(
      `\nassert-rank-engine-purity: FAILED — rank engine is not pure:\n${violations
        .map((v) => `  - ${v}`)
        .join(
          '\n',
        )}\n\nThe rank engine must import ONLY @obikai/domain (plus pure math/util libs) and must\nnever reach a DB, framework, queue, cloud SDK, or AI client. See ADR-0003 / ADR-0005.\n`,
    );
    process.exit(1);
    return;
  }

  process.stdout.write(
    'assert-rank-engine-purity: PASS — rank engine closure is pure (no DB/framework/AI; ' +
      'only @obikai/domain).\n',
  );
  process.exit(0);
}

main();
