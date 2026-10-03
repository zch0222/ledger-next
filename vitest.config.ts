import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      // Pure modules only; database, auth and HTTP paths are verified by the Docker E2E suite, not by mocks.
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: [
        'packages/domain/src/policy.ts',
        'packages/domain/src/cursor.ts',
        'packages/domain/src/idempotency.ts',
        'packages/domain/src/money.ts',
        'packages/domain/src/dates.ts',
        'packages/domain/src/fx-pure.ts',
        'packages/domain/src/fx-provider.ts',
        'packages/domain/src/csv.ts',
        'packages/domain/src/report-periods.ts',
        'packages/domain/src/schedule.ts',
        'packages/domain/src/secrets.ts',
        'packages/domain/src/net-guard.ts',
        'packages/domain/src/reminder-schedule.ts',
        'packages/db/src/migrate-files.ts',
        'packages/mcp/src/*.ts',
        'packages/contracts/src/*.ts',
        'packages/ui/src/theme.mjs',
        'packages/ui/src/format.ts',
        'apps/web/src/lib/period.ts',
        'apps/web/src/lib/time.ts',
      ],
      exclude: ['packages/contracts/src/cli.ts'],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 90 },
    },
  },
});
