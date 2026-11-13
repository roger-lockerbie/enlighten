import { createHash } from 'node:crypto';
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

/** Spike only: a minimal same-origin WebSocket echo on /ws, to test connect-src 'self'. */
function spikeWebSocket(): Plugin {
  return {
    name: 'enlighten-spike-ws',
    configurePreviewServer(server) {
      server.httpServer.on('upgrade', (req, socket) => {
        const key = req.headers['sec-websocket-key'];
        if (req.url !== '/ws' || typeof key !== 'string') {
          socket.destroy();
          return;
        }
        const accept = createHash('sha1')
          .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest('base64');
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        socket.on('data', (buf: Buffer) => {
          const opcode = (buf[0] ?? 0) & 0x0f;
          const len = (buf[1] ?? 0) & 0x7f;
          if (opcode !== 1 || len > 125) {
            socket.end();
            return;
          }
          const mask = buf.subarray(2, 6);
          const payload = Buffer.from(
            buf.subarray(6, 6 + len).map((b, i) => b ^ (mask[i % 4] ?? 0)),
          );
          socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), metaFallback(), spikeWebSocket()],
  worker: { format: 'es' },
  server: {
    host: HOST,
    port: DEV_PORT,
    strictPort: true,
    allowedHosts: [HOST],
    headers: securityHeaders('dev'),
  },
  preview: {
    host: HOST,
    port: PREVIEW_PORT,
    strictPort: true,
    allowedHosts: [HOST],
    headers: securityHeaders('strict'),
  },
  build: {
    target: 'es2023',
    sourcemap: false,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
});
