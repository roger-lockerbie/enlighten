/**
 * U-manual: the manual's own files (ADR 0024). The generated pages are what the generator makes,
 * every link and picture resolves, every console line parses, the pages stay inside the Markdown
 * subset and the writing rules, and the hardware marks match the ledger.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLine, type ParseContext } from '../../src/console/parse.ts';
import { parseScript } from '../../src/script/parse.ts';
import { buildBook, resolveLink, resolvePath } from '../../src/manual/book.ts';
import { generatedPages } from '../../src/manual/generate.ts';
import { cells, type Block, type Inline } from '../../src/manual/markdown.ts';

const ROOT = resolve(import.meta.dirname, '..', '..', 'docs', 'manual');

function walk(dir: string, prefix = ''): string[] {
  return readdirSync(resolve(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`, `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  );
}

const paths = walk('.');
const files = Object.fromEntries(
  paths.filter((p) => p.endsWith('.md')).map((p) => [p, readFileSync(resolve(ROOT, p), 'utf8')]),
);
const book = buildBook(files);
const pictures = paths.filter((p) => p.startsWith('img/'));
const written = Object.entries(files).filter(([p]) => !p.startsWith('generated/'));

/** Every block of a page, nested ones included. */
function* blocksOf(bs: readonly Block[]): Generator<Block> {
  for (const b of bs) {
    yield b;
    if (b.t === 'list') for (const it of b.items) yield* blocksOf(it);
    if (b.t === 'quote' || b.t === 'callout') yield* blocksOf(b.c);
  }
}

function* linksOf(nodes: readonly Inline[]): Generator<string> {
  for (const n of nodes) {
    if (n.t === 'link') yield n.href;
    if (n.t === 'strong' || n.t === 'em' || n.t === 'link') yield* linksOf(n.c);
  }
}

function* inlinesOf(b: Block): Generator<readonly Inline[]> {
  if (b.t === 'heading' || b.t === 'para') yield b.c;
  if (b.t === 'table') {
    yield* b.head;
    for (const r of b.rows) yield* r;
  }
}

describe('the generated pages', () => {
  it('are what `pnpm manual:gen` writes now', () => {
    for (const [path, text] of Object.entries(generatedPages()))
      expect(files[path] === text, `${path} is stale: run pnpm manual:gen`).toBe(true);
    expect(
      Object.keys(files)
        .filter((p) => p.startsWith('generated/'))
        .sort(),
    ).toEqual(Object.keys(generatedPages()).sort());
  });
});

describe('every page', () => {
  it('has a title and an order', () => {
    for (const p of book.pages) {
      expect(p.doc.meta['title'], p.path).toBeTruthy();
      expect(Number.isFinite(Number(p.doc.meta['order'])), p.path).toBe(true);
      expect(p.doc.blocks[0], p.path).toMatchObject({ t: 'heading', level: 1 });
    }
  });

  it('links only to pages and headings that exist', () => {
    for (const p of book.pages)
      for (const b of blocksOf(p.doc.blocks))
        for (const line of inlinesOf(b))
          for (const href of linksOf(line)) {
            const t = resolveLink(book, p.path, href);
            expect(t.kind, `${p.path}: ${href}`).not.toBe('none');
            if (t.kind === 'none') continue;
            const target = t.kind === 'page' ? book.byPath.get(t.path) : p;
            if (t.anchor !== undefined) {
              const ids = [...blocksOf(target?.doc.blocks ?? [])].flatMap((x) =>
                x.t === 'heading' ? [x.id] : [],
              );
              expect(ids, `${p.path}: ${href}`).toContain(t.anchor);
            }
          }
  });

  it('shows only pictures that exist, and every picture is shown somewhere', () => {
    const used = new Set<string>();
    for (const p of book.pages)
      for (const b of blocksOf(p.doc.blocks))
        if (b.t === 'image') {
          const path = resolvePath(p.path, b.src);
          expect(path !== undefined && pictures.includes(path), `${p.path}: ${b.src}`).toBe(true);
          expect(b.alt.trim(), `${p.path}: ${b.src} needs a caption`).not.toBe('');
          if (path !== undefined) used.add(path);
        }
    expect([...used].sort()).toEqual([...pictures].sort());
  });

  it('gives console lines the console accepts', () => {
    const ctx: ParseContext = { aliases: new Map() };
    let lines = 0;
    for (const p of book.pages)
      for (const b of blocksOf(p.doc.blocks))
        if (b.t === 'code' && b.lang === 'console')
          for (const line of b.text.split('\n')) {
            if (line.trim() === '' || line.trim().startsWith('#')) continue;
            const r = parseLine(line, ctx);
            expect(r.ok ? '' : r.error, `${p.path}: ${line}`).toBe('');
            lines++;
          }
    expect(lines).toBeGreaterThan(0);
  });

  it('gives scripts the script parser accepts', () => {
    const ctx: ParseContext = { aliases: new Map() };
    for (const p of book.pages)
      for (const b of blocksOf(p.doc.blocks))
        if (b.t === 'code' && b.lang === 'script') {
          const r = parseScript(b.text, ctx);
          expect(r.ok ? [] : r.errors, p.path).toEqual([]);
        }
  });

  it('marks code blocks with a kind the viewer knows', () => {
    for (const p of book.pages)
      for (const b of blocksOf(p.doc.blocks))
        if (b.t === 'code') expect(['console', 'text', 'script', 'bash'], p.path).toContain(b.lang);
  });
});

describe('every file', () => {
  it('gives every table row as many cells as its head', () => {
    // The parser pads a short row, which would hide a cell that swallowed its neighbours (SH2-3).
    for (const [path, text] of Object.entries(files)) {
      const lines = text.split('\n');
      for (let i = 0; i + 1 < lines.length; i++) {
        const head = lines[i] ?? '';
        const rule = cells(lines[i + 1] ?? '');
        if (!head.includes('|') || rule.length === 0 || !rule.every((c) => /^:?-{3,}:?$/.test(c)))
          continue;
        const n = cells(head).length;
        expect(rule.length, `${path}:${String(i + 2)}`).toBe(n);
        for (let j = i + 2; j < lines.length && (lines[j] ?? '').includes('|'); j++)
          // An empty last cell is written `| |`, which `cells` leaves out.
          expect(cells(lines[j] ?? '').length, `${path}:${String(j + 1)}`).toBeGreaterThanOrEqual(
            n - 1,
          );
        for (let j = i + 2; j < lines.length && (lines[j] ?? '').includes('|'); j++)
          expect(cells(lines[j] ?? '').length, `${path}:${String(j + 1)}`).toBeLessThanOrEqual(n);
      }
    }
  });

  it('has no raw HTML outside code, the generated pages included (SH2-6)', () => {
    for (const [path, text] of Object.entries(files)) {
      const prose = text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`\n]*`/g, '')
        .replace(/\\</g, '');
      const m = /<\/?[a-z][^>\n]*>/i.exec(prose);
      expect(m === null ? '' : m[0], path).toBe('');
    }
  });

  it('has no control characters and no characters that reorder text', () => {
    // By code point, not by a pattern: tab, newline and carriage return are the only controls
    // allowed, and no mark that changes the direction text is drawn in.
    const bad = (c: number): boolean =>
      (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) ||
      c === 0x7f ||
      c === 0x200e ||
      c === 0x200f ||
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0x2066 && c <= 0x2069);
    for (const [path, text] of Object.entries(files))
      expect(
        [...text].some((ch) => bad(ch.codePointAt(0) ?? 0)),
        path,
      ).toBe(false);
  });
});

describe('the pages written by hand', () => {
  it('stay inside the Markdown subset', () => {
    for (const [path, text] of written) {
      const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
      expect(/<\/?[a-z][^>]*>/i.test(prose), `${path}: raw HTML`).toBe(false);
      expect(prose.includes('[['), `${path}: a wikilink`).toBe(false);
      expect(/^#{5,}\s/m.test(prose), `${path}: a heading below level 4`).toBe(false);
      expect(/^\s{4,}[-*+]\s/m.test(prose), `${path}: a list nested three deep`).toBe(false);
      expect(/!\[[^\]]*\]\([^)]*\)[^\n]/.test(prose), `${path}: a picture inside a line`).toBe(
        false,
      );
    }
  });

  it('follow the writing rules', () => {
    const banned =
      /[–—]|\b(very|really|truly|extremely|absolutely|literally|basically|obviously|clearly|leverage|canonical|legible|landed|quietly|handwave|pushback|in order to|due to the fact that|prior to|in terms of|with regard to|load bearing|surface area|blast radius|circle back|honest take)\b/i;
    for (const [path, text] of written) {
      const m = banned.exec(text);
      expect(m === null ? '' : m[0], path).toBe('');
      for (const line of text.split('\n'))
        expect(/^(So|Well|Look|Now)[ ,]/.test(line.trim()), `${path}: ${line}`).toBe(false);
    }
  });
});

describe('the hardware ledger', () => {
  it('lists exactly the marks the pages carry', () => {
    const marked = new Set<string>();
    for (const p of book.pages) {
      if (p.path === 'hardware-ledger.md') continue;
      for (const b of blocksOf(p.doc.blocks))
        if (b.t === 'callout')
          for (const m of b.title.matchAll(/\b(HW-\d{2})\b/g)) {
            expect(b.kind, `${p.path}: ${b.title}`).toBe('warning');
            expect(b.title, p.path).toMatch(/^Untried on hardware \(HW-\d{2}\)$/);
            if (m[1] !== undefined) marked.add(m[1]);
          }
    }
    const ledger = book.byPath.get('hardware-ledger.md');
    const table = [...blocksOf(ledger?.doc.blocks ?? [])].find((b) => b.t === 'table');
    if (table?.t !== 'table') throw new Error('The ledger has no table.');
    const text = (cell: readonly Inline[] | undefined): string =>
      (cell ?? []).map((n) => (n.t === 'text' || n.t === 'code' ? n.v : '')).join('');
    const listed = table.rows.map((r) => text(r[0]).trim());
    expect([...listed].sort()).toEqual([...marked].sort());
    expect(new Set(listed).size).toBe(listed.length);
    // Each row names a page that carries its mark.
    for (const r of table.rows) {
      const id = text(r[0]).trim();
      const pages = [...linksOf(r[1] ?? [])].map((h) => resolvePath('hardware-ledger.md', h));
      expect(pages.length, id).toBeGreaterThan(0);
      for (const path of pages) {
        const page = path === undefined ? undefined : book.byPath.get(path);
        const has = [...blocksOf(page?.doc.blocks ?? [])].some(
          (b) => b.t === 'callout' && b.title.includes(id),
        );
        expect(has, `${id} is not marked in ${String(path)}`).toBe(true);
      }
    }
  });
});
