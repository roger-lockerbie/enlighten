/** U-manual: the book made from the manual's pages: order, links, search and names. */
import { describe, expect, it } from 'vitest';
import { buildBook, findPage, resolveLink, resolvePath, search } from './book.ts';

const book = buildBook({
  'README.md': '---\ntitle: Contents\norder: 0\n---\n# Enlighten manual\n\nStart here.',
  'guide/02-ceiling-and-panic.md':
    '---\ntitle: The ceiling and panic\norder: 2\n---\n# The ceiling and panic\n\nLower it freely.\n\n## Panic\n\nEscape twice.',
  'guide/01-the-bench.md': '---\ntitle: The bench\norder: 1\n---\n# The bench\n\nTwo tapes.',
  'reference/safety.md': '# Safety\n\nThe rate guard and the ceiling.',
  'generated/keys.md': '---\ntitle: Keys\norder: 1\n---\n# Keys',
  'hardware-ledger.md': '# Hardware ledger',
  'img/topbar.png': 'not a page',
});

describe('the book', () => {
  it('puts pages in reading order: start, guide, reference, tables, the rest', () => {
    expect(book.pages.map((p) => p.path)).toEqual([
      'README.md',
      'guide/01-the-bench.md',
      'guide/02-ceiling-and-panic.md',
      'reference/safety.md',
      'generated/keys.md',
      'hardware-ledger.md',
    ]);
    expect(book.pages.map((p) => p.section)).toEqual([
      'start',
      'guide',
      'guide',
      'reference',
      'generated',
      'other',
    ]);
  });

  it('takes a title from the frontmatter, or the first heading', () => {
    expect(book.byPath.get('README.md')?.title).toBe('Contents');
    expect(book.byPath.get('reference/safety.md')?.title).toBe('Safety');
  });

  it('follows a link only to a page of the book, or a heading on this page', () => {
    const from = 'guide/02-ceiling-and-panic.md';
    expect(resolveLink(book, from, '../reference/safety.md')).toEqual({
      kind: 'page',
      path: 'reference/safety.md',
    });
    expect(resolveLink(book, from, '01-the-bench.md#two-tapes')).toEqual({
      kind: 'page',
      path: 'guide/01-the-bench.md',
      anchor: 'two-tapes',
    });
    expect(resolveLink(book, from, '#panic')).toEqual({ kind: 'anchor', anchor: 'panic' });
    for (const href of [
      'https://example.com/x.md',
      '//example.com/x.md',
      'javascript:alert(1)',
      'data:text/html,x',
      '/etc/passwd',
      '../../../README.md',
      '../missing.md',
      '../img/topbar.png',
      '',
      '#',
    ])
      expect(resolveLink(book, from, href), href).toEqual({ kind: 'none' });
    expect(resolvePath('guide/a.md', '../img/x.png')).toBe('img/x.png');
    expect(resolvePath('a.md', '../x.png')).toBeUndefined();
  });

  it('finds pages that have every word, title matches first', () => {
    expect(search(book, 'ceiling').map((h) => h.page.path)).toEqual([
      'guide/02-ceiling-and-panic.md',
      'reference/safety.md',
    ]);
    expect(search(book, 'RATE guard')[0]?.snippet).toContain('the rate guard and the ceiling');
    expect(search(book, 'ceiling zebra')).toEqual([]);
    expect(search(book, '   ')).toEqual([]);
  });

  it('finds a page by its file, its title or part of its title', () => {
    expect(findPage(book, 'safety')?.path).toBe('reference/safety.md');
    expect(findPage(book, 'reference/safety.md')?.path).toBe('reference/safety.md');
    expect(findPage(book, 'ceiling-and-panic')?.path).toBe('guide/02-ceiling-and-panic.md');
    expect(findPage(book, 'The Bench')?.path).toBe('guide/01-the-bench.md');
    expect(findPage(book, 'ledger')?.path).toBe('hardware-ledger.md');
    expect(findPage(book, 'nothing like it')).toBeUndefined();
  });
});
