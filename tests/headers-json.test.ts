/** U-headers: the JSON the build writes for the hardware server is the preview's header set. */
import { describe, expect, it } from 'vitest';
import { securityHeaders, serverHeadersJson } from '../config/security.ts';

describe('dist/headers.json', () => {
  it('is exactly the strict header set', () => {
    expect(JSON.parse(serverHeadersJson())).toEqual(securityHeaders('strict'));
  });
});
