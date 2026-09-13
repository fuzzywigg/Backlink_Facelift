import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 90,
        statements: 100,
      },
    },
  },
});
