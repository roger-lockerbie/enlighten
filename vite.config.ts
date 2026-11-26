import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';
import {
  DEV_PORT,
  HOST,
  metaFallbackTags,
  PREVIEW_PORT,
  securityHeaders,
  serverHeadersJson,
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

/** Writes dist/headers.json, the header set the hardware server sends on every response. */
function serverHeaders(): Plugin {
  return {
    name: 'enlighten-server-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'headers.json', source: serverHeadersJson() });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), metaFallback(), serverHeaders()],
  server: {
    host: HOST,
    port: DEV_PORT,
    strictPort: true,
    allowedHosts: [HOST],
    // Vite's default answers other local origins with CORS headers. This app has no use for them.
    cors: false,
    headers: securityHeaders('dev'),
  },
  preview: {
    host: HOST,
    port: PREVIEW_PORT,
    strictPort: true,
    allowedHosts: [HOST],
    cors: false,
    headers: securityHeaders('strict'),
  },
  build: {
    target: 'es2023',
    sourcemap: false,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    // three.js is one lazily loaded chunk of about 540 kB (ADR 0002). e2e/bundle.spec.ts holds the
    // entry chunk to its own budget.
    chunkSizeWarningLimit: 700,
  },
});
