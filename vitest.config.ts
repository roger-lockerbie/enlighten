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
          setupFiles: ['tests/harness/seed.ts'],
        },
      },
      {
        test: {
          name: 'prop',
          include: ['src/**/*.prop.test.ts', 'tests/**/*.prop.test.ts', 'config/**/*.prop.test.ts'],
          environment: 'node',
          setupFiles: ['tests/harness/seed.ts'],
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
        'src/console/**/*.ts',
        'src/script/**/*.ts',
        'src/design/**/*.ts',
        'src/switch/**/*.ts',
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
