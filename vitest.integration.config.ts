import { defineConfig } from 'vitest/config';
// Real MySQL integration suite. Needs DATABASE_URL; `pnpm test:e2e` runs it inside the isolated Docker stack.
export default defineConfig({ test: {
  include: ['tests/integration/**/*.test.ts'],
  fileParallelism: false, testTimeout: 60000, hookTimeout: 60000,
} });
