import fc from 'fast-check';
import { describe, it } from 'vitest';
import { cspDirectives, type Mode } from '../config/security';

describe('CSP properties', () => {
  it('never allows eval, remote origins or a wildcard in any mode', () => {
    fc.assert(
      fc.property(fc.constantFrom<Mode>('strict', 'dev'), fc.boolean(), (mode, forMeta) => {
        const csp = cspDirectives(mode, { forMeta });
        return (
          !csp.includes('unsafe-eval') &&
          !csp.includes('*') &&
          !/https?:/.test(csp) &&
          csp.includes("default-src 'none'") &&
          csp.includes("object-src 'none'")
        );
      }),
    );
  });

  it('script-src is always just self', () => {
    fc.assert(
      fc.property(fc.constantFrom<Mode>('strict', 'dev'), fc.boolean(), (mode, forMeta) =>
        cspDirectives(mode, { forMeta }).split('; ').includes("script-src 'self'"),
      ),
    );
  });
});
