/** U-manual: the manual's Markdown subset, parsed to a tree (ADR 0024). */
import { describe, expect, it } from 'vitest';
import { docText, inlineText, parseInline, parseMarkdown, slug } from './markdown.ts';

const blocks = (s: string) => parseMarkdown(s).blocks;

describe('inline text', () => {
  it('reads code, bold, italic and links', () => {
    expect(parseInline('a `b*c` **d** *e* [f](g.md#h)')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'code', v: 'b*c' },
      { t: 'text', v: ' ' },
      { t: 'strong', c: [{ t: 'text', v: 'd' }] },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'e' }] },
      { t: 'text', v: ' ' },
      { t: 'link', href: 'g.md#h', c: [{ t: 'text', v: 'f' }] },
    ]);
    expect(parseInline('**bold with `code` in it**')).toEqual([
      {
        t: 'strong',
        c: [
          { t: 'text', v: 'bold with ' },
          { t: 'code', v: 'code' },
          { t: 'text', v: ' in it' },
        ],
      },
    ]);
  });

  it('leaves what does not match as it was typed', () => {
    expect(inlineText(parseInline('2 * 3 * 4'))).toBe('2 * 3 * 4');
    expect(parseInline('snake_case_name')).toEqual([{ t: 'text', v: 'snake_case_name' }]);
    expect(parseInline('a ` b')).toEqual([{ t: 'text', v: 'a ` b' }]);
    expect(parseInline('[not a link]')).toEqual([{ t: 'text', v: '[not a link]' }]);
    expect(parseInline('<b>html</b> <script>x</script>')).toEqual([
      { t: 'text', v: '<b>html</b> <script>x</script>' },
    ]);
    expect(parseInline('a \\* b \\| c')).toEqual([{ t: 'text', v: 'a * b | c' }]);
  });

  it('makes heading anchors as GitHub and Obsidian do', () => {
    expect(slug('The ceiling, and Panic!')).toBe('the-ceiling-and-panic');
    expect(slug('`help -k <word>`')).toBe('help--k-word');
  });
});

describe('blocks', () => {
  it('reads frontmatter, headings and paragraphs', () => {
    const d = parseMarkdown('---\ntitle: Safety\norder: 2\n---\n\n# Safety\n\nOne\ntwo.\n\nThree.');
    expect(d.meta).toEqual({ title: 'Safety', order: '2' });
    expect(d.blocks).toEqual([
      { t: 'heading', level: 1, c: [{ t: 'text', v: 'Safety' }], id: 'safety' },
      { t: 'para', c: [{ t: 'text', v: 'One two.' }] },
      { t: 'para', c: [{ t: 'text', v: 'Three.' }] },
    ]);
    expect(parseMarkdown('---\n__proto__: x\nconstructor: y\n---\n').meta).toEqual({});
  });

  it('reads fenced code as it is, markup and all', () => {
    expect(blocks('```console\nlevel 0 **50%**\n# not a heading\n```\nafter')).toEqual([
      { t: 'code', lang: 'console', text: 'level 0 **50%**\n# not a heading' },
      { t: 'para', c: [{ t: 'text', v: 'after' }] },
    ]);
    // A fence that is never closed takes the rest of the page.
    expect(blocks('```\na\nb')).toEqual([{ t: 'code', lang: '', text: 'a\nb' }]);
  });

  it('reads lists, two levels, ordered and not', () => {
    expect(blocks('- a\n- b\n  - c\n  - d\n- e')).toEqual([
      {
        t: 'list',
        ordered: false,
        items: [
          [{ t: 'para', c: [{ t: 'text', v: 'a' }] }],
          [
            { t: 'para', c: [{ t: 'text', v: 'b' }] },
            {
              t: 'list',
              ordered: false,
              items: [
                [{ t: 'para', c: [{ t: 'text', v: 'c' }] }],
                [{ t: 'para', c: [{ t: 'text', v: 'd' }] }],
              ],
            },
          ],
          [{ t: 'para', c: [{ t: 'text', v: 'e' }] }],
        ],
      },
    ]);
    const ol = blocks('1. one\n2. two\n\nafter');
    expect(ol[0]).toMatchObject({ t: 'list', ordered: true });
    expect(ol[1]).toEqual({ t: 'para', c: [{ t: 'text', v: 'after' }] });
    // A code block inside an item stays in the item.
    const withCode = blocks('1. Type:\n\n   ```console\n   cap 40%\n   ```\n2. Next');
    expect(withCode).toHaveLength(1);
    expect(withCode[0]).toMatchObject({
      t: 'list',
      items: [[{ t: 'para' }, { t: 'code', lang: 'console', text: 'cap 40%' }], [{ t: 'para' }]],
    });
  });

  it('reads tables, with bars in code spans and escaped bars kept in their cell', () => {
    const t = blocks(
      '| Key | Does |\n| --- | :--- |\n| `a | b` | x \\| y |\n| short |\n| 1 | 2 | 3 |',
    );
    expect(t).toEqual([
      {
        t: 'table',
        head: [[{ t: 'text', v: 'Key' }], [{ t: 'text', v: 'Does' }]],
        rows: [
          [[{ t: 'code', v: 'a | b' }], [{ t: 'text', v: 'x | y' }]],
          [[{ t: 'text', v: 'short' }], []],
          [[{ t: 'text', v: '1' }], [{ t: 'text', v: '2' }]],
        ],
      },
    ]);
  });

  it('reads quotes, callouts, images and rules', () => {
    expect(blocks('> quoted\n> more')).toEqual([
      { t: 'quote', c: [{ t: 'para', c: [{ t: 'text', v: 'quoted more' }] }] },
    ]);
    expect(blocks('> [!WARNING] Untried on hardware (HW-07)\n> The level may fade.')).toEqual([
      {
        t: 'callout',
        kind: 'warning',
        title: 'Untried on hardware (HW-07)',
        c: [{ t: 'para', c: [{ t: 'text', v: 'The level may fade.' }] }],
      },
    ]);
    expect(blocks('![The playground](../img/playground.png)\n\n---')).toEqual([
      { t: 'image', alt: 'The playground', src: '../img/playground.png' },
      { t: 'rule' },
    ]);
  });

  it('keeps raw HTML as text', () => {
    expect(blocks('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>')).toEqual([
      { t: 'para', c: [{ t: 'text', v: '<img src=x onerror=alert(1)>' }] },
      { t: 'para', c: [{ t: 'text', v: '<script>alert(1)</script>' }] },
    ]);
  });

  it('gives the text of a page for search', () => {
    const d = parseMarkdown(
      '# Title\n\nSome **bold** text.\n\n- item `one`\n\n| a | b |\n| --- | --- |\n| c | d |\n\n> [!NOTE] Mind\n> this\n\n```\ncode\n```',
    );
    expect(docText(d.blocks)).toBe('Title\nSome bold text.\nitem one\na b\nc d\nMind\nthis\ncode');
  });

  it('stops nesting at a fixed depth', () => {
    const deep = `${'> '.repeat(40)}end`;
    expect(JSON.stringify(blocks(deep))).toContain('end');
    const nested = `${'[a]('.repeat(30)}x${')'.repeat(30)}`;
    expect(() => parseInline(nested)).not.toThrow();
  });
});
