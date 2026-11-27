/** P-manual: the parser takes any text without throwing, and never loses plain words. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { docText, MAX_PAGE, parseMarkdown } from './markdown.ts';

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

  it('answers in good time for the worst pages it can be given (SH2-1)', () => {
    const N = MAX_PAGE;
    const blanks = ' '.repeat(40_000);
    const hostile: Record<string, string> = {
      'a heading with a long run of blanks': `# x${blanks}y`,
      'a fence with a long run of blanks': `\`\`\`${blanks}!`,
      'a table rule of blanks': `a|b\n${blanks}x`,
      'a bullet across a line separator': `- ${blanks}a\u2028b`,
      'a number across a line separator': `1. ${blanks}a\u2029b`,
      'a callout of blanks': `> [!NOTE]${blanks}\u2028x`,
      'frontmatter of blanks': `---\ntitle:${blanks}\u2028x\n---\n`,
      'links that never close': `${'[a]'.repeat(N / 3 - 2)}](x)`,
      'brackets alone': '['.repeat(N),
      'emphasis that never closes': '*a '.repeat(N / 3),
      underscores: '_'.repeat(N),
      'backticks, odd': '`a'.repeat(N / 2 - 1),
      'quotes nested deep': '> '.repeat(N / 2),
      'bullets nested deep': Array.from(
        { length: 2000 },
        (_, i) => `${' '.repeat(i % 60)}- x`,
      ).join('\n'),
      'table bars': `${'|'.repeat(1000)}\n${'|---'.repeat(250)}\n${`${'|'.repeat(1000)}\n`.repeat(300)}`,
      'one long line': 'x'.repeat(N),
      'mixed marks': '*_`[](!|#>- \\'.repeat(N / 14),
    };
    for (const mark of ['*', '_', '`', '[', '](', '> ', '- ', '|', '#', ' ', '\u2028'])
      hostile[`only ${JSON.stringify(mark)}`] = mark.repeat(Math.floor(N / mark.length));
    for (const [name, src] of Object.entries(hostile)) {
      const t = performance.now();
      parseMarkdown(src);
      expect(performance.now() - t, name).toBeLessThan(1500);
    }
  }, 60_000);
});
