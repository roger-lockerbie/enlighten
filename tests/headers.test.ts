import { describe, expect, it } from 'vitest';
import {
  cspDirectives,
  metaFallbackTags,
  permissionsPolicy,
  securityHeaders,
} from '../config/security';

describe('strict headers', () => {
  const headers = securityHeaders('strict');

  it('sets the full header set', () => {
    expect(Object.keys(headers).sort()).toEqual(
      [
        'Cache-Control',
        'Content-Security-Policy',
        'Cross-Origin-Embedder-Policy',
        'Cross-Origin-Opener-Policy',
        'Cross-Origin-Resource-Policy',
        'Permissions-Policy',
        'Referrer-Policy',
        'X-Content-Type-Options',
        'X-Frame-Options',
      ].sort(),
    );
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(headers['Cross-Origin-Embedder-Policy']).toBe('require-corp');
    expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin');
  });

  it('has a strict CSP', () => {
    const csp = headers['Content-Security-Policy'] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/https?:|wss?:|\*/);
  });

  it('allows only screen-wake-lock, for self, and turns hid and fullscreen off', () => {
    const policy = permissionsPolicy();
    expect(policy.match(/=\(self\)/g)).toEqual(['=(self)']);
    expect(policy).toContain('screen-wake-lock=(self)');
    for (const feature of [
      'hid',
      'fullscreen',
      'camera',
      'microphone',
      'geolocation',
      'usb',
      'serial',
      'bluetooth',
      'payment',
    ]) {
      expect(policy).toContain(`${feature}=()`);
    }
  });

  // Chromium logs 'Unrecognized feature' for ambient-light-sensor, attribution-reporting and web-share,
  // so those three are left out (docs/THREAT_MODEL.md section 4).
  it('turns off the wider list from the threat model, section 4', () => {
    const off = new Set(
      permissionsPolicy()
        .split(', ')
        .filter((d) => d.endsWith('=()'))
        .map((d) => d.slice(0, -3)),
    );
    for (const feature of [
      'autoplay',
      'encrypted-media',
      'gamepad',
      'idle-detection',
      'local-fonts',
      'picture-in-picture',
      'publickey-credentials-create',
      'identity-credentials-get',
      'otp-credentials',
      'storage-access',
      'window-management',
      'compute-pressure',
      'captured-surface-control',
      'speaker-selection',
      'browsing-topics',
    ]) {
      expect(off.has(feature), feature).toBe(true);
    }
  });
});

describe('meta fallback', () => {
  it('leaves out frame-ancestors, which meta tags ignore', () => {
    expect(cspDirectives('strict', { forMeta: true })).not.toContain('frame-ancestors');
    expect(metaFallbackTags().join('')).toContain('no-referrer');
  });
});

describe('dev headers', () => {
  it('grant no device features', () => {
    expect(permissionsPolicy()).toContain('hid=()');
    expect(permissionsPolicy()).not.toContain('hid=(self)');
  });

  it('name one Trusted Types policy in production, the worker policy', () => {
    const csp = securityHeaders('strict')['Content-Security-Policy'] ?? '';
    expect(csp).toMatch(/(^|; )trusted-types enlighten-worker(;|$)/);
    expect(csp).not.toContain('svelte-trusted-html');
  });

  it('relax only what hot reload needs', () => {
    const csp = securityHeaders('dev')['Content-Security-Policy'] ?? '';
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain('ws://127.0.0.1:47820');
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("default-src 'none'");
  });
});
