import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

// Path aliases from tsconfig.json: workspace modules by name, apps/web/src as @/.
const packagePath = {
  regex: '^(\.\./)+(packages/)?(api-client|contracts|db|domain|mcp|ui)/src/',
  message: 'Import workspace modules as @ledger/<package>/<module>.',
};
const webParent = { regex: '^\.\./', message: 'Import from another folder of apps/web/src as @/<path>.' };
const webAlias = { regex: '^@/', message: 'Packages must not depend on apps/web.' };

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  { settings: { next: { rootDir: 'apps/web' }, react: { version: '19.3' } } },
  // Layout belongs to Prettier (`pnpm format`); this turns off the stylistic rules that would disagree with it.
  prettier,
  {
    rules: {
      // One declaration per statement: `const a = …, b = …` hides state and handlers at the end of long lines.
      'one-var': ['error', 'never'],
      // Braces once a body no longer fits on the `if` line (re-enabled after eslint-config-prettier on purpose).
      curly: ['error', 'multi-line'],
      'no-restricted-imports': ['error', { patterns: [packagePath] }],
    },
  },
  { files: ['apps/web/src/**'], rules: { 'no-restricted-imports': ['error', { patterns: [packagePath, webParent] }] } },
  { files: ['packages/**'], rules: { 'no-restricted-imports': ['error', { patterns: [packagePath, webAlias] }] } },
  globalIgnores(['**/.next/**', '**/dist/**', 'coverage/**', 'docs/**']),
]);
