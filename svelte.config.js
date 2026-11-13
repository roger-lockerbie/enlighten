import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    runes: true,
    fragments: process.env['SPIKE_FRAGMENTS'] === 'tree' ? 'tree' : 'html',
  },
};
