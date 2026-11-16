import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          // The engine tests drive long runs on the virtual clock. Under Stryker's instrumentation
          // one of them takes longer than the default 5 s.
          testTimeout: 20_000,
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'config/**/*.test.ts'],
          exclude: ['**/*.prop.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'prop',
          include: ['src/**/*.prop.test.ts', 'tests/**/*.prop.test.ts', 'config/**/*.prop.test.ts'],
          environment: 'node',
        },
      },
    ],
    // Targets from docs/TEST_PLAN.md section 1: 90% of lines on the pure core, 95% of branches on
    // src/safety. `pnpm coverage` runs the unit and property tests together against them.
    coverage: {
      provider: 'v8',
      include: [
        'src/dali/**/*.ts',
        'src/sim/**/*.ts',
        'src/bus/**/*.ts',
        'src/safety/**/*.ts',
        'src/engine/**/*.ts',
        'src/transport/**/*.ts',
        'src/light/**/*.ts',
        'src/store/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/index.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: {
        lines: 90,
        'src/safety/**': { lines: 90, branches: 95 },
      },
    },
  },
});
