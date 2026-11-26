/**
 * Tab completion (SPEC R7.5): command names, addresses, scene numbers and script names. Tab is taken
 * only when there is something to complete, so focus can always leave the console by keyboard
 * (docs/research/console.md section 9).
 */
import type { Completion } from './editor.ts';
import { lex } from './lex.ts';
import { DALI_NAMES } from './names.ts';
import { FRIENDLY, QUERY_WORDS, UNLOCKS, EXPLAINABLE, type CommandName } from './parse.ts';
import { HELP_TOPICS } from './help.ts';

export interface CompleteContext {
  /** Short addresses in the inventory. */
  readonly addresses: readonly number[];
  readonly aliases: readonly string[];
  readonly scripts: readonly string[];
}

/** Commands that take an address first. */
const ADDRESSED = new Set([
  'level',
  'off',
  'on',
  'tc',
  'rgb',
  'fade',
  'scene',
  'group',
  'query',
  'profile',
  'use',
]);

const SCENE_OPS = ['recall', 'store', 'remove', 'list'];
const GROUPS = Array.from({ length: 16 }, (_, i) => `g${String(i)}`);
const NUMBERS = Array.from({ length: 16 }, (_, i) => String(i));

function commonPrefix(items: readonly string[]): string {
  const first = items[0] ?? '';
  let n = first.length;
  for (const s of items) {
    let i = 0;
    while (i < n && s[i] === first[i]) i++;
    n = i;
  }
  return first.slice(0, n);
}

/** The kind of command a first word starts: one of the console's own, or a DALI command by name. */
function wordCommand(w: string | undefined): CommandName {
  const head = (w ?? '').toLowerCase();
  const own = FRIENDLY.find((f) => f === head);
  return own ?? (DALI_NAMES.has(head) ? 'dali' : 'help');
}

/** Every word that may come next after the words already typed. */
function candidates(words: readonly string[], ctx: CompleteContext): string[] {
  const head = words[0]?.toLowerCase();
  if (words.length === 0 || head === undefined) return [...FRIENDLY, ...DALI_NAMES.keys()];
  const addresses = [...ctx.addresses.map(String), ...GROUPS, 'all', ...ctx.aliases];
  const at = words.length;
  switch (head) {
    case 'run':
      return at === 1 ? [...ctx.scripts] : [];
    case 'help':
      return at === 1 ? [...HELP_TOPICS, ...DALI_NAMES.keys()] : [];
    case 'explain':
      // The rest of the line completes as the line it explains, from the commands explain covers.
      return at === 1
        ? [...EXPLAINABLE.filter((c) => c !== 'dali'), ...DALI_NAMES.keys()]
        : EXPLAINABLE.includes(wordCommand(words[1]))
          ? candidates(words.slice(1), ctx)
          : [];
    case 'unlock':
    case 'lock':
      return at === 1 ? [...UNLOCKS] : [];
    case 'target':
      return at === 1 ? ['sim', 'hw', 'both'] : [];
    case 'trace':
      return at === 1 ? ['on', 'off'] : [];
    case 'scene':
      if (at === 1) return addresses;
      if (at === 2) return SCENE_OPS;
      return at === 3 && words[2] !== 'list' ? NUMBERS : [];
    case 'group':
      if (at === 1) return addresses;
      if (at === 2) return ['add', 'remove'];
      return at === 3 ? NUMBERS : [];
    case 'query':
      if (at === 1) return addresses;
      return at === 2
        ? [
            ...Object.keys(QUERY_WORDS),
            ...[...DALI_NAMES.keys()].filter((n) => n.startsWith('query-')).map((n) => n.slice(6)),
          ]
        : [];
    case 'profile':
      return at === 1 ? ['apply', ...addresses] : [];
    case 'go-to-scene':
      if (at === 1) return addresses;
      return at === 2 ? NUMBERS : [];
    default:
      if (
        at === 1 &&
        (ADDRESSED.has(head) || (DALI_NAMES.get(head)?.kind ?? 'special') !== 'special')
      )
        return addresses;
      return [];
  }
}

/** Complete the word at the cursor, or undefined when nothing completes. */
export function complete(
  buffer: string,
  cursor: number,
  ctx: CompleteContext,
): Completion | undefined {
  const before = buffer.slice(0, cursor);
  const lexed = lex(before);
  if (!lexed.ok || lexed.comment !== undefined) return undefined;
  const tokens = lexed.tokens;
  const last = tokens[tokens.length - 1];
  const inWord = last?.end === before.length && !last.quoted;
  const prefix = inWord ? last.text : '';
  if (prefix === '' && before.trim() === '') return undefined;
  const words = (inWord ? tokens.slice(0, -1) : tokens).map((t) => t.text);
  const lower = prefix.toLowerCase();
  const items = [...new Set(candidates(words, ctx))]
    .filter((c) => c.toLowerCase().startsWith(lower))
    .sort();
  if (items.length === 0) return undefined;
  const from = inWord ? last.start : cursor;
  if (items.length === 1) {
    const only = items[0] ?? '';
    if (only === prefix && buffer.charAt(cursor) === ' ') return undefined;
    return { from, to: cursor, text: `${only} `, items: [] };
  }
  const common = commonPrefix(items);
  return { from, to: cursor, text: common.length > prefix.length ? common : prefix, items };
}
