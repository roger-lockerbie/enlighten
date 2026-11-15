/** The self-hosted fonts are the files recorded in SHA256SUMS, with their licences beside them. */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(import.meta.dirname, '..', 'src', 'assets', 'fonts');

describe('the fonts', () => {
  const sums = readFileSync(join(dir, 'SHA256SUMS'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => l.split(/\s+/) as [string, string]);

  it('match their recorded SHA-256 sums', () => {
    for (const [sum, file] of sums)
      expect(
        createHash('sha256')
          .update(readFileSync(join(dir, file)))
          .digest('hex'),
        file,
      ).toBe(sum);
  });

  it('list every font and licence file in the folder', () => {
    const listed = sums.map(([, f]) => f).sort();
    const present = readdirSync(dir)
      .filter((f) => f.endsWith('.woff2') || f.endsWith('.txt'))
      .sort();
    expect(listed).toEqual(present);
  });

  it('are WOFF2 files under the Open Font License', () => {
    for (const [, f] of sums) {
      const b = readFileSync(join(dir, f));
      if (f.endsWith('.woff2')) expect(b.subarray(0, 4).toString('latin1')).toBe('wOF2');
      else expect(b.toString('utf8')).toContain('SIL Open Font License, Version 1.1');
    }
  });
});
