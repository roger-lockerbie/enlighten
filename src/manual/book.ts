/**
 * The manual as a book (ADR 0024): the pages in reading order, their titles, the links between them
 * and a word search. Pure: it is given the files' text and knows nothing of how they were loaded.
 *
 * A link or an image is followed only when it names a page or an image in the book. Anything else,
 * an address on another origin included, is shown as text and never as a link.
 */
import { docText, parseMarkdown, type Doc } from './markdown.ts';

export type Section = 'start' | 'guide' | 'reference' | 'generated' | 'other';

export const SECTION_TITLES: Readonly<Record<Section, string>> = {
  start: 'Start',
  guide: 'Guide',
  reference: 'Reference',
  generated: 'Tables',
  other: 'More',
};

const SECTION_ORDER: readonly Section[] = ['start', 'guide', 'reference', 'generated', 'other'];

export interface ManualPage {
  /** The file's path under `docs/manual/`, such as `reference/safety.md`. */
  readonly path: string;
  readonly title: string;
  readonly section: Section;
  readonly order: number;
  readonly doc: Doc;
  /** The page's words in lower case, for the search. */
  readonly words: string;
}

export interface Book {
  readonly pages: readonly ManualPage[];
  readonly byPath: ReadonlyMap<string, ManualPage>;
}

export type LinkTarget =
  | { readonly kind: 'page'; readonly path: string; readonly anchor?: string }
  | { readonly kind: 'anchor'; readonly anchor: string }
  | { readonly kind: 'none' };

function sectionOf(path: string): Section {
  if (path === 'README.md') return 'start';
  const dir = path.split('/')[0];
  return dir === 'guide' || dir === 'reference' || dir === 'generated' ? dir : 'other';
}

/** Build the book from the files' text, keyed by path under `docs/manual/`. */
export function buildBook(files: Readonly<Record<string, string>>): Book {
  const pages: ManualPage[] = [];
  for (const [path, source] of Object.entries(files)) {
    if (!path.endsWith('.md')) continue;
    const doc = parseMarkdown(source);
    const h1 = doc.blocks.find((b) => b.t === 'heading' && b.level === 1);
    const title =
      doc.meta['title'] ??
      (h1?.t === 'heading' ? docText([h1]) : path.replace(/^.*\//, '').replace(/\.md$/, ''));
    const order = Number(doc.meta['order'] ?? Number.NaN);
    pages.push({
      path,
      title,
      section: sectionOf(path),
      order: Number.isFinite(order) ? order : 1000,
      doc,
      words: `${title}\n${docText(doc.blocks)}`.toLowerCase(),
    });
  }
  pages.sort(
    (a, b) =>
      SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) ||
      a.order - b.order ||
      a.path.localeCompare(b.path),
  );
  return { pages, byPath: new Map(pages.map((p) => [p.path, p])) };
}

/** `a/b.md` and `../img/x.png` from a page's own path to a path under `docs/manual/`. */
export function resolvePath(from: string, to: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(to) || to.startsWith('//') || to.startsWith('/'))
    return undefined;
  const parts = from.split('/').slice(0, -1);
  for (const seg of to.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

/** Where a link in a page goes: a page of the book, a heading on this page, or nowhere. */
export function resolveLink(book: Book, from: string, href: string): LinkTarget {
  const hash = href.indexOf('#');
  const file = hash < 0 ? href : href.slice(0, hash);
  const anchor = hash < 0 ? undefined : href.slice(hash + 1);
  if (file === '')
    return anchor === undefined || anchor === '' ? { kind: 'none' } : { kind: 'anchor', anchor };
  const path = resolvePath(from, file);
  if (path === undefined || !book.byPath.has(path)) return { kind: 'none' };
  return anchor === undefined || anchor === ''
    ? { kind: 'page', path }
    : { kind: 'page', path, anchor };
}

export interface Hit {
  readonly page: ManualPage;
  /** A few words around the first place the page has the query. */
  readonly snippet: string;
}

/** Pages that have every word of the query, title matches first. */
export function search(book: Book, query: string): Hit[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '');
  if (words.length === 0) return [];
  const hits: (Hit & { rank: number })[] = [];
  for (const page of book.pages) {
    if (!words.every((w) => page.words.includes(w))) continue;
    const first = words[0] ?? '';
    const at = page.words.indexOf(first);
    const from = Math.max(0, at - 40);
    const snippet = page.words
      .slice(from, at + first.length + 80)
      .replace(/\s+/g, ' ')
      .trim();
    const inTitle = words.every((w) => page.title.toLowerCase().includes(w));
    hits.push({ page, snippet: `${from > 0 ? '... ' : ''}${snippet} ...`, rank: inTitle ? 0 : 1 });
  }
  return hits.sort((a, b) => a.rank - b.rank).map(({ page, snippet }) => ({ page, snippet }));
}

/** A page by a short name, for `manual <page>`: a path, a file name without `.md`, or a title. */
export function findPage(book: Book, name: string): ManualPage | undefined {
  const n = name.toLowerCase().replace(/\.md$/, '');
  return (
    book.pages.find((p) => p.path.toLowerCase().replace(/\.md$/, '') === n) ??
    book.pages.find(
      (p) =>
        p.path.toLowerCase().replace(/^.*\//, '').replace(/\.md$/, '').replace(/^\d+-/, '') === n,
    ) ??
    book.pages.find((p) => p.title.toLowerCase() === n) ??
    book.pages.find((p) => p.title.toLowerCase().includes(n))
  );
}
