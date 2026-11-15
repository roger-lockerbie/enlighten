import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  // `fragments: 'tree'` builds templates with DOM calls, so Svelte makes no Trusted Types policy (ADR 0002).
  compilerOptions: { runes: true, fragments: 'tree' },
};
