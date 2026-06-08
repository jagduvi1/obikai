import tsParser from '@typescript-eslint/parser';
// Minimal ESLint config — Biome does general lint/format. ESLint is kept ONLY to enforce
// architectural import boundaries that Biome cannot yet express (ADR-0003).
//
// The load-bearing rule: packages/rank-engine may import ONLY packages/domain. It must never
// reach a DB, an adapter, a framework, or the AI adapter — that is what makes the engine pure,
// deterministic, and "AI never in the rank path" a compile-time guarantee. This is independently
// re-verified by scripts/assert-rank-engine-purity.mjs so a single misconfig cannot open the seam.
import boundaries from 'eslint-plugin-boundaries';

const elements = [
  { type: 'domain', pattern: 'packages/domain/**' },
  { type: 'adapter-contracts', pattern: 'packages/adapter-contracts/**' },
  { type: 'rank-engine', pattern: 'packages/rank-engine/**' },
  { type: 'api-client', pattern: 'packages/api-client/**' },
  { type: 'config', pattern: 'packages/config/**' },
  { type: 'authz', pattern: 'packages/authz/**' },
  { type: 'db', pattern: 'packages/db/**' },
  { type: 'gdpr', pattern: 'packages/gdpr/**' },
  { type: 'i18n', pattern: 'packages/i18n/**' },
  { type: 'notifications', pattern: 'packages/notifications/**' },
  { type: 'test-utils', pattern: 'packages/test-utils/**' },
  { type: 'adapter-impl', pattern: 'adapters/**' },
  { type: 'app', pattern: 'apps/**' },
];

export default [
  {
    files: ['packages/*/src/**/*.ts', 'adapters/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.tsbuildinfo', '**/test/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { sourceType: 'module', ecmaVersion: 'latest' },
    },
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['packages/*/src/**/*', 'adapters/*/src/**/*', 'apps/*/src/**/*'],
      'boundaries/elements': elements,
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: ['packages/*/tsconfig.json', 'adapters/*/tsconfig.json', 'apps/*/tsconfig.json'],
        },
      },
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // The crown-jewel rule: the rank engine may depend on NOTHING but domain.
            { from: 'rank-engine', allow: ['domain'] },
            { from: 'domain', allow: [] },
            // The shared browser API client is a leaf: framework-free, depends on nothing.
            { from: 'api-client', allow: [] },
            { from: 'adapter-contracts', allow: ['domain'] },
            { from: 'config', allow: ['domain'] },
            { from: 'authz', allow: ['domain'] },
            { from: 'i18n', allow: ['domain'] },
            // Transactional email rendering: pure, framework-free; depends only on the email port
            // contract, domain types, and the i18n catalogs. Used by both api and worker.
            { from: 'notifications', allow: ['domain', 'adapter-contracts', 'i18n'] },
            { from: 'gdpr', allow: ['domain', 'adapter-contracts'] },
            // db may implement the gdpr ports (audit log, consent, identity-map, keystore) and reuse
            // its pure hash-chain primitives. gdpr is a DB-free leaf (domain + adapter-contracts only),
            // so db→gdpr is acyclic; gdpr never imports db. See ADR-0026.
            { from: 'db', allow: ['domain', 'config', 'gdpr'] },
            { from: 'adapter-impl', allow: ['adapter-contracts', 'domain', 'config'] },
            { from: 'test-utils', allow: ['domain', 'adapter-contracts', 'rank-engine', 'config'] },
            {
              from: 'app',
              allow: [
                'domain',
                'api-client',
                'config',
                'authz',
                'adapter-contracts',
                'rank-engine',
                'db',
                'gdpr',
                'i18n',
                'notifications',
                'adapter-impl',
                'test-utils',
              ],
            },
          ],
        },
      ],
    },
  },
];
