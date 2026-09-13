import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts'],
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
