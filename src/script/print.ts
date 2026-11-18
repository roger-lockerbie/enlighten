/**
 * A parsed script printed back to text, with comments dropped and repeat blocks indented. Words are
 * printed as they were written, so the text parses to the same steps (P-parser).
 */
import { tokenText, type Item } from './parse.ts';

export function printScript(items: readonly Item[]): string {
  const out: string[] = [];
  const walk = (list: readonly Item[], indent: string) => {
    for (const it of list) {
      if (it.kind === 'statement') {
        out.push(indent + it.tokens.map(tokenText).join(' '));
        continue;
      }
      out.push(`${indent}repeat ${String(it.count)}`);
      walk(it.body, `${indent}  `);
      out.push(`${indent}end`);
    }
  };
  walk(items, '');
  return out.join('\n');
}
