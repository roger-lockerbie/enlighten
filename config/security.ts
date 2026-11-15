/**
 * Security headers for `vite preview` (and a relaxed set for `vite dev`).
 * Pure TypeScript with no Vite imports, so tests can check it in Node.
 */

export const DEV_PORT = 47820;
export const PREVIEW_PORT = 47821;
export const HOST = '127.0.0.1';

export type Mode = 'strict' | 'dev';

/**
 * The one Trusted Types policy (ADR 0002). It is made in `src/workers/policy.ts` and passes only the
 * worker URLs fixed at build time. Svelte compiles with `fragments: 'tree'`, so it makes no policy.
 */
export const TRUSTED_TYPES_POLICY = 'enlighten-worker';

/** Features turned off for every origin. */
const DISABLED_FEATURES = [
  'accelerometer',
  'bluetooth',
  'camera',
  'display-capture',
  'fullscreen',
  'geolocation',
  'gyroscope',
  'hid',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'publickey-credentials-get',
  'serial',
  'usb',
  'xr-spatial-tracking',
];

/**
 * Features the app uses, for its own origin only. `hid` is off until a WebHID transport is built
 * (ADR 0003), so no device grant can exist on the app's origin. `fullscreen` is off because element
 * fullscreen would hide the Panic button and take Escape (SPEC S4.1).
 */
const SELF_FEATURES = ['screen-wake-lock'];

/** The same for the dev server and for production: neither origin gets device features. */
export function permissionsPolicy(): string {
  const off = DISABLED_FEATURES.map((f) => `${f}=()`);
  const self = SELF_FEATURES.map((f) => `${f}=(self)`);
  return [...off, ...self].join(', ');
}

/**
 * Content Security Policy directives. `frame-ancestors` is dropped for the meta tag,
 * because browsers ignore it there.
 */
export function cspDirectives(mode: Mode, { forMeta = false } = {}): string {
  const dev = mode === 'dev';
  const directives: Record<string, string[]> = {
    'default-src': ["'none'"],
    'script-src': ["'self'"],
    'style-src': dev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    'img-src': ["'self'"],
    'font-src': ["'self'"],
    'connect-src': dev ? ["'self'", `ws://${HOST}:${String(DEV_PORT)}`] : ["'self'"],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  };
  if (!forMeta) {
    directives['frame-ancestors'] = ["'none'"];
  }
  if (!dev) {
    directives['require-trusted-types-for'] = ["'script'"];
    directives['trusted-types'] = [TRUSTED_TYPES_POLICY];
  }
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

export function securityHeaders(mode: Mode): Record<string, string> {
  return {
    'Content-Security-Policy': cspDirectives(mode),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': permissionsPolicy(),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store',
  };
}

/** Meta tags for the built page, for hosts that can't set headers. Only CSP and referrer work in a meta tag. */
export function metaFallbackTags(): string[] {
  return [
    `<meta http-equiv="Content-Security-Policy" content="${cspDirectives('strict', { forMeta: true })}" />`,
    '<meta name="referrer" content="no-referrer" />',
  ];
}

/**
 * The header set the hardware server sends, as JSON. The build writes it to dist/headers.json, so the
 * server and `vite preview` send the same headers from one source (ADR 0003).
 */
export function serverHeadersJson(): string {
  return `${JSON.stringify(securityHeaders('strict'), null, 2)}\n`;
}
