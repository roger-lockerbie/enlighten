/**
 * The manual's Markdown (ADR 0024): a fixed subset, parsed to a typed tree that the viewer draws as
 * ordinary elements with text nodes. Nothing here makes HTML, and nothing in a page is ever run or
 * handed to the browser as markup. Text outside the subset stays text.
 *
 * The subset: a frontmatter block of `key: value` lines; headings `#` to `####`; paragraphs; fenced
 * code; unordered and ordered lists, two levels; tables; block quotes; callouts (`> [!NOTE]`,
 * `> [!WARNING]`, `> [!TIP]`); images on a line of their own; rules; and inline bold, italic, code
 * and links. Raw HTML is not in it.
 */

export type Inline =
  | { readonly t: 'text'; readonly v: string }
  | { readonly t: 'code'; readonly v: string }
  | { readonly t: 'strong'; readonly c: readonly Inline[] }
  | { readonly t: 'em'; readonly c: readonly Inline[] }
  | { readonly t: 'link'; readonly href: string; readonly c: readonly Inline[] };

export type CalloutKind = 'note' | 'warning' | 'tip';

export type Block =
  | {
      readonly t: 'heading';
      readonly level: 1 | 2 | 3 | 4;
      readonly c: readonly Inline[];
      readonly id: string;
    }
  | { readonly t: 'para'; readonly c: readonly Inline[] }
  | { readonly t: 'code'; readonly lang: string; readonly text: string }
  | { readonly t: 'list'; readonly ordered: boolean; readonly items: readonly (readonly Block[])[] }
  | {
      readonly t: 'table';
      readonly head: readonly (readonly Inline[])[];
      readonly rows: readonly (readonly (readonly Inline[])[])[];
    }
  | { readonly t: 'quote'; readonly c: readonly Block[] }
  | {
      readonly t: 'callout';
      readonly kind: CalloutKind;
      readonly title: string;
      readonly c: readonly Block[];
    }
  | { readonly t: 'image'; readonly src: string; readonly alt: string }
  | { readonly t: 'rule' };

export interface Doc {
  readonly meta: Readonly<Record<string, string>>;
  readonly blocks: readonly Block[];
}

/** The longest page the parser reads. A page is a few thousand words; this is far above that. */
export const MAX_PAGE = 400_000;
/** How deep lists and quotes may nest before the rest is read as paragraphs. */
const MAX_DEPTH = 4;

// -------------------------------------------------------------------------------------------------
// Inline

const text = (v: string): Inline => ({ t: 'text', v });

/** Join neighbouring text nodes, and drop empty ones. */
function tidy(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.t === 'text') {
      if (n.v === '') continue;
      if (last?.t === 'text') {
        out[out.length - 1] = text(last.v + n.v);
        continue;
      }
    }
    out.push(n);
  }
  return out;
}

/** Inline text: code spans first, then links, bold and italic. Anything unmatched stays as typed. */
export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf !== '') out.push(text(buf));
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (ch === '\\' && i + 1 < src.length && /[\\`*_[\]()!|#>-]/.test(src.charAt(i + 1))) {
      buf += src.charAt(i + 1);
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({ t: 'code', v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '[' && depth < MAX_DEPTH) {
      const close = src.indexOf('](', i + 1);
      const end = close < 0 ? -1 : src.indexOf(')', close + 2);
      if (close > i && end > close && !src.slice(i + 1, close).includes('[')) {
        flush();
        out.push({
          t: 'link',
          href: src.slice(close + 2, end).trim(),
          c: parseInline(src.slice(i + 1, close), depth + 1),
        });
        i = end + 1;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && depth < MAX_DEPTH) {
      const double = src.charAt(i + 1) === ch;
      const mark = double ? ch + ch : ch;
      const end = src.indexOf(mark, i + mark.length);
      const inner = end < 0 ? '' : src.slice(i + mark.length, end);
      // An underscore inside a word (snake_case) is not emphasis.
      const inWord = ch === '_' && /\w/.test(src.charAt(i - 1));
      if (end > i && inner !== '' && inner.trim() === inner && !inWord) {
        flush();
        out.push({ t: double ? 'strong' : 'em', c: parseInline(inner, depth + 1) });
        i = end + mark.length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return tidy(out);
}

/** The text of inline nodes, with the marks gone. */
export function inlineText(nodes: readonly Inline[]): string {
  return nodes.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : inlineText(n.c))).join('');
}

/** A heading's anchor: lower case, words joined by hyphens, as GitHub and Obsidian make them. */
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// -------------------------------------------------------------------------------------------------
// Blocks

const FENCE = /^(`{3,})\s*([\w-]*)\s*$/;
const HEADING = /^(#{1,4})\s+(.*?)\s*#*\s*$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const NUMBER = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
const CALLOUT = /^\[!(NOTE|WARNING|TIP)\]\s*(.*)$/i;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** The cells of a table row. A `\|` is a bar inside a cell, and a bar inside a code span stays. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let code = false;
  const t = line.trim().replace(/^\|/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t.charAt(i);
    if (ch === '\\' && t.charAt(i + 1) === '|') {
      cur += '|';
      i++;
    } else if (ch === '`') {
      code = !code;
      cur += ch;
    } else if (ch === '|' && !code) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

const startsBlock = (line: string): boolean =>
  FENCE.test(line) ||
  HEADING.test(line) ||
  RULE.test(line) ||
  BULLET.test(line) ||
  NUMBER.test(line) ||
  line.startsWith('>') ||
  IMAGE.test(line.trim());

function parseBlocks(lines: readonly string[], depth: number): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence !== null) {
      const mark = fence[1] ?? '```';
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith(mark)) body.push(lines[i++] ?? '');
      i++;
      out.push({ t: 'code', lang: (fence[2] ?? '').toLowerCase(), text: body.join('\n') });
      continue;
    }
    const h = HEADING.exec(line);
    if (h !== null) {
      const c = parseInline(h[2] ?? '');
      out.push({
        t: 'heading',
        level: (h[1] ?? '#').length as 1 | 2 | 3 | 4,
        c,
        id: slug(inlineText(c)),
      });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push({ t: 'rule' });
      i++;
      continue;
    }
    const img = IMAGE.exec(line.trim());
    if (img !== null) {
      out.push({ t: 'image', alt: img[1] ?? '', src: img[2] ?? '' });
      i++;
      continue;
    }
    if (line.startsWith('>') && depth < MAX_DEPTH) {
      const body: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('>'))
        body.push((lines[i++] ?? '').replace(/^> ?/, ''));
      const first = CALLOUT.exec(body[0] ?? '');
      if (first !== null) {
        const kind = (first[1] ?? 'note').toLowerCase() as CalloutKind;
        out.push({
          t: 'callout',
          kind,
          title: (first[2] ?? '').trim(),
          c: parseBlocks(body.slice(1), depth + 1),
        });
      } else out.push({ t: 'quote', c: parseBlocks(body, depth + 1) });
      continue;
    }
    const li = BULLET.exec(line) ?? NUMBER.exec(line);
    if (li !== null && depth < MAX_DEPTH) {
      const ordered = BULLET.exec(line) === null;
      const indent = (li[1] ?? '').length;
      const items: Block[][] = [];
      while (i < lines.length) {
        const cur = lines[i] ?? '';
        const m = (ordered ? NUMBER : BULLET).exec(cur);
        if (m === null || (m[1] ?? '').length !== indent) break;
        // The item's own line, then every line indented under it, or blank before more of it.
        const body: string[] = [m[3] ?? ''];
        // Where the item's text starts: lines under it lose that much indent, no more.
        const column = cur.length - (m[3] ?? '').length;
        i++;
        while (i < lines.length) {
          const next = lines[i] ?? '';
          const lead = /^\s*/.exec(next)?.[0].length ?? 0;
          if (next.trim() === '') {
            const after = lines[i + 1] ?? '';
            const afterLead = /^\s*/.exec(after)?.[0].length ?? 0;
            if (after.trim() !== '' && afterLead > indent) {
              body.push('');
              i++;
              continue;
            }
            break;
          }
          if (lead <= indent) break;
          body.push(next.slice(Math.min(lead, column)));
          i++;
        }
        items.push(parseBlocks(body, depth + 1));
      }
      out.push({ t: 'list', ordered, items });
      continue;
    }
    if (line.includes('|') && TABLE_RULE.test(lines[i + 1] ?? '')) {
      const head = cells(line).map((c) => parseInline(c));
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim() !== '') {
        const row = cells(lines[i++] ?? '').map((c) => parseInline(c));
        // Every row has the head's number of cells: short rows are filled, long ones cut.
        while (row.length < head.length) row.push([]);
        rows.push(row.slice(0, head.length));
      }
      out.push({ t: 'table', head, rows });
      continue;
    }
    // A paragraph: lines up to a blank line or the start of another block.
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !startsBlock(lines[i] ?? ''))
      para.push((lines[i++] ?? '').trim());
    out.push({ t: 'para', c: parseInline(para.join(' ')) });
  }
  return out;
}

/** Parse one page. It never throws: text it does not know stays text. */
export function parseMarkdown(source: string): Doc {
  const lines = source.slice(0, MAX_PAGE).replace(/\r\n?/g, '\n').split('\n');
  const meta: Record<string, string> = {};
  let start = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      for (const l of lines.slice(1, end)) {
        const m = /^([a-z][\w-]*):\s*(.*)$/i.exec(l);
        const key = m?.[1]?.toLowerCase();
        if (key !== undefined && key !== '__proto__' && key !== 'constructor')
          meta[key] = (m?.[2] ?? '').trim().replace(/^"(.*)"$/, '$1');
      }
      start = end + 1;
    }
  }
  return { meta, blocks: parseBlocks(lines.slice(start), 0) };
}

/** Every block's text, for search: headings, paragraphs, cells, code and callout titles. */
export function docText(blocks: readonly Block[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.t) {
      case 'heading':
      case 'para':
        parts.push(inlineText(b.c));
        break;
      case 'code':
        parts.push(b.text);
        break;
      case 'list':
        for (const it of b.items) parts.push(docText(it));
        break;
      case 'table':
        parts.push(b.head.map(inlineText).join(' '));
        for (const r of b.rows) parts.push(r.map(inlineText).join(' '));
        break;
      case 'quote':
        parts.push(docText(b.c));
        break;
      case 'callout':
        parts.push(b.title, docText(b.c));
        break;
      case 'image':
        parts.push(b.alt);
        break;
      case 'rule':
        break;
    }
  }
  return parts.filter((p) => p !== '').join('\n');
}
