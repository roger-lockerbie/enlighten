/** P-manual: the parser takes any text without throwing, and never loses plain words. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { docText, parseMarkdown } from './markdown.ts';

const runs = Number(process.env['PROP_RUNS'] ?? 200) * 5;

const piece = fc.oneof(
  fc.constantFrom(
    '#',
    '## ',
    '- ',
    '1. ',
    '> ',
    '> [!NOTE] ',
    '```',
    '```console',
    '|',
    ' | ',
    '---',
    '| --- |',
    '*',
    '**',
    '_',
    '`',
    '[',
    '](',
    ')',
    '![',
    '\\',
    '<',
    '>',
    '\n',
    '\n\n',
    '  ',
    '    ',
    '\t',
    '---\n',
    'title: x\n',
    '__proto__: y\n',
    '<script>',
    'javascript:',
    'http://x.example/',
  ),
  fc.string({ maxLength: 12 }),
  fc.stringMatching(/^[a-z]{1,8}$/),
);

describe('P-manual', () => {
  it('parses anything, to a tree that is only data', () => {
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 60 }), (parts) => {
        const src = parts.join('');
        const doc = parseMarkdown(src);
        // The tree is plain data: it survives JSON unchanged.
        expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
        expect(typeof docText(doc.blocks)).toBe('string');
      }),
      { numRuns: runs },
    );
  });

  it('keeps every word of plain prose, in order', () => {
    const word = fc.stringMatching(/^[a-z]{1,8}$/);
    const prose = fc.array(fc.array(word, { minLength: 1, maxLength: 8 }), {
      minLength: 1,
      maxLength: 6,
    });
    fc.assert(
      fc.property(prose, (paras) => {
        const src = paras.map((p) => p.join(' ')).join('\n\n');
        const doc = parseMarkdown(src);
        expect(docText(doc.blocks).split(/\s+/)).toEqual(paras.flat());
      }),
      { numRuns: runs },
    );
  });

  it('answers in good time for a page of nothing but marks', () => {
    for (const mark of ['*', '_', '`', '[', '](', '> ', '- ', '|', '#']) {
      const src = mark.repeat(20_000);
      const t = performance.now();
      parseMarkdown(src);
      expect(performance.now() - t, mark).toBeLessThan(2000);
    }
  });
});
