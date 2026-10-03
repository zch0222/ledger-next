import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';
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
    },
  },
  globalIgnores(['**/.next/**', '**/dist/**', 'coverage/**', 'docs/**']),
]);
