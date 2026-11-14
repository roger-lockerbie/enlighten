import js from '@eslint/js';
import globals from 'globals';
import sveltePlugin from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import tseslint from 'typescript-eslint';
import { sinkConfig } from './eslint.sinks.js';
import { boundaryConfig } from './eslint.boundary.js';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      'node_modules/',
      'reports/',
      '.stryker-tmp/',
      'server/',
      'tools/golden/.venv/',
    ],
  },
  {
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  ...sveltePlugin.configs['flat/recommended'],
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: { allowDefaultProject: ['*.js'] },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  ...sinkConfig,
  ...boundaryConfig,
  {
    // These files name the banned sinks on purpose: the rule definitions, the lint test and the e2e test
    // that proves the browser refuses them. Inline disable comments are off everywhere.
    files: ['eslint.sinks.js', 'e2e/csp.spec.ts', 'tests/lint/sinks.test.ts'],
    rules: { 'no-restricted-syntax': 'off', 'no-eval': 'off' },
  },
);
