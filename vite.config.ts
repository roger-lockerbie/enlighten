import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';
import {
  DEV_PORT,
  HOST,
  metaFallbackTags,
  PREVIEW_PORT,
  securityHeaders,
} from './config/security.ts';

/** Puts the CSP and referrer meta tags first in <head> of the built page. */
function metaFallback(): Plugin {
  return {
    name: 'enlighten-meta-fallback',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace('<head>', `<head>\n    ${metaFallbackTags().join('\n    ')}`),
    },
  };
}

export default defineConfig({
  plugins: [svelte(), metaFallback()],
  server: {
    host: HOST,
    port: DEV_PORT,
    strictPort: true,
    allowedHosts: [HOST, 'localhost'],
    headers: securityHeaders('dev'),
  },
  preview: {
    host: HOST,
    port: PREVIEW_PORT,
    strictPort: true,
    allowedHosts: [HOST, 'localhost'],
    headers: securityHeaders('strict'),
  },
  build: {
    target: 'es2023',
    sourcemap: false,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
});
