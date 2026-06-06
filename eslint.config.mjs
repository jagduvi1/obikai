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
  { type: 'config', pattern: 'packages/config/**' },
  { type: 'authz', pattern: 'packages/authz/**' },
  { type: 'db', pattern: 'packages/db/**' },
  { type: 'gdpr', pattern: 'packages/gdpr/**' },
  { type: 'i18n', pattern: 'packages/i18n/**' },
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
            { from: 'adapter-contracts', allow: ['domain'] },
            { from: 'config', allow: ['domain'] },
            { from: 'authz', allow: ['domain'] },
            { from: 'i18n', allow: ['domain'] },
            { from: 'gdpr', allow: ['domain', 'adapter-contracts'] },
            { from: 'db', allow: ['domain', 'config'] },
            { from: 'adapter-impl', allow: ['adapter-contracts', 'domain', 'config'] },
            { from: 'test-utils', allow: ['domain', 'adapter-contracts', 'rank-engine', 'config'] },
            {
              from: 'app',
              allow: [
                'domain',
                'config',
                'authz',
                'adapter-contracts',
                'rank-engine',
                'db',
                'gdpr',
                'i18n',
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
