/**
 * Security headers for `vite preview` (and a relaxed set for `vite dev`).
 * Pure TypeScript with no Vite imports, so tests can check it in Node.
 */

export const DEV_PORT = 47820;
export const PREVIEW_PORT = 47821;
export const HOST = '127.0.0.1';

export type Mode = 'strict' | 'dev';

/** The one Trusted Types policy Svelte 5 creates, for its compiled static templates. */
export const TRUSTED_TYPES_POLICY = 'svelte-trusted-html';

/** Spike: SPIKE_FRAGMENTS=tree drops Svelte's policy. The worker policy is always allowed. */
export const SPIKE_TREE = process.env['SPIKE_FRAGMENTS'] === 'tree';
export const TRUSTED_TYPES_POLICIES = SPIKE_TREE
  ? ['enlighten-worker']
  : [TRUSTED_TYPES_POLICY, 'enlighten-worker'];

/** Features turned off for every origin. */
const DISABLED_FEATURES = [
  'accelerometer',
  'bluetooth',
  'camera',
  'display-capture',
  'geolocation',
  'gyroscope',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'publickey-credentials-get',
  'serial',
  'usb',
  'xr-spatial-tracking',
];

/** Features the app uses, for its own origin only. */
const SELF_FEATURES = ['hid', 'screen-wake-lock', 'fullscreen'];

/** The dev server is a separate origin, so it gets no device features at all. */
export function permissionsPolicy(mode: Mode = 'strict'): string {
  const off = (mode === 'dev' ? [...DISABLED_FEATURES, 'hid'] : DISABLED_FEATURES).map(
    (f) => `${f}=()`,
  );
  const self = (mode === 'dev' ? SELF_FEATURES.filter((f) => f !== 'hid') : SELF_FEATURES).map(
    (f) => `${f}=(self)`,
  );
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
    directives['trusted-types'] = TRUSTED_TYPES_POLICIES;
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
    'Permissions-Policy': permissionsPolicy(mode),
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
