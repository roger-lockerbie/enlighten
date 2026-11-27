/**
 * The manual's files, bundled with the app (ADR 0024). The Markdown is read as text and the images
 * as the build's own hashed files, so the viewer only ever shows what was in `docs/manual/` when
 * the app was built. This module is loaded the first time the manual is opened, as one chunk.
 */
import { buildBook, type Book } from './book.ts';

// The viewer takes everything through this module, so the parser and the book's code travel in
// this chunk with the text, and none of it is shared with the page that shows it.
export { findPage, resolveLink, resolvePath, search, SECTION_TITLES } from './book.ts';

const ROOT = '/docs/manual/';

const sources = import.meta.glob<string>('/docs/manual/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const pictures = import.meta.glob<string>('/docs/manual/img/*.png', {
  query: '?url',
  import: 'default',
  eager: true,
});

const strip = (files: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(files).map(([k, v]) => [k.slice(ROOT.length), v]));

export const book: Book = buildBook(strip(sources));

/** The built file for an image path under `docs/manual/`, such as `img/playground.png`. */
export const images: ReadonlyMap<string, string> = new Map(Object.entries(strip(pictures)));
