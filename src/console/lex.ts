/**
 * Splitting a console line into words (SPEC section 6): blanks separate words, double quotes group a
 * string, and `#` at the start of a word starts a comment. `#rrggbb` is a colour, not a comment.
 */

export interface Token {
  readonly text: string;
  /** Where the word starts in the line, for completion and errors. */
  readonly start: number;
  readonly end: number;
  /** The word was written in double quotes. */
  readonly quoted: boolean;
}

export type Lexed =
  | { readonly ok: true; readonly tokens: readonly Token[]; readonly comment?: string }
  | { readonly ok: false; readonly error: string };

const COLOUR = /^#[0-9a-fA-F]{6}(?=\s|$)/;

export function lex(line: string): Lexed {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line.charAt(i);
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '#' && !COLOUR.test(line.slice(i))) {
      return { ok: true, tokens, comment: line.slice(i + 1) };
    }
    const start = i;
    if (ch === '"') {
      const end = line.indexOf('"', i + 1);
      if (end < 0) return { ok: false, error: 'A double quote is not closed.' };
      tokens.push({ text: line.slice(i + 1, end), start, end: end + 1, quoted: true });
      i = end + 1;
      if (i < line.length && !/\s/.test(line.charAt(i)))
        return { ok: false, error: 'Put a space after a closing double quote.' };
      continue;
    }
    while (i < line.length && !/\s/.test(line.charAt(i))) {
      if (line.charAt(i) === '"')
        return { ok: false, error: 'A double quote starts inside a word.' };
      i++;
    }
    tokens.push({ text: line.slice(start, i), start, end: i, quoted: false });
  }
  return { ok: true, tokens };
}

/** Put a string back in double quotes when it needs them, for printing a script. */
export function quote(text: string): string {
  return text === '' || /[\s#"]/.test(text) ? `"${text}"` : text;
}
