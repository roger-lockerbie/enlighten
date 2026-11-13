import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
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
  },
});
