import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  include: ['tests/unit/**/*.test.ts'],
  coverage: {
    // Pure modules only; database, auth and HTTP paths are verified by the Docker E2E suite, not by mocks.
    provider: 'v8', reporter: ['text', 'json-summary', 'html'],
    include: [
      'packages/domain/src/policy.ts', 'packages/domain/src/cursor.ts', 'packages/domain/src/idempotency.ts',
      'packages/contracts/src/*.ts', 'packages/ui/src/theme.mjs',
    ],
    exclude: ['packages/contracts/src/cli.ts'],
    thresholds: { lines: 95, statements: 95, functions: 95, branches: 90 },
  },
} });
