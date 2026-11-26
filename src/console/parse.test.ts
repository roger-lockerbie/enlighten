/** U-console: the command language (SPEC section 6): lexer, values, names and parser. */
import { describe, expect, it } from 'vitest';
import { broadcast, group, short, unaddressed } from '../dali/address.ts';
import { COMMANDS, spec } from '../dali/commands.ts';
import { lex } from './lex.ts';
import { byName, DALI_NAMES, kebab, nameOf } from './names.ts';
import { aliasProblem, FRIENDLY, parseLine, parseTarget, type ParseContext } from './parse.ts';
import { channel, colour, hexByte, level, msText, temperature, time } from './values.ts';

const ctx: ParseContext = {
  aliases: new Map([
    ['tw', 0],
    ['rgb1', 1],
  ]),
};
const withUse: ParseContext = { ...ctx, use: [short(0)] };

const cmd = (line: string, c = ctx) => {
  const r = parseLine(line, c);
  if (!r.ok) throw new Error(`${line}: ${r.error}`);
  return r.command;
};
const err = (line: string, c = ctx) => {
  const r = parseLine(line, c);
  if (r.ok) throw new Error(`${line} parsed`);
  return r.error;
};

describe('lex', () => {
  it('splits on blanks, groups double quotes and drops comments', () => {
    const r = lex('pause "two  words" # a comment');
    expect(r.ok && r.tokens.map((t) => [t.text, t.quoted])).toEqual([
      ['pause', false],
      ['two  words', true],
    ]);
    expect(r.ok && r.comment).toBe(' a comment');
    expect(lex('rgb 0 #ff8000 # orange').ok && (lex('rgb 0 #ff8000').ok ? 'ok' : '')).toBe('ok');
    const c = lex('rgb 0 #ff8000 #x');
    expect(c.ok && c.tokens.map((t) => t.text)).toEqual(['rgb', '0', '#ff8000']);
  });

  it('reports bad quotes', () => {
    expect(lex('echo "open')).toEqual({ ok: false, error: 'A double quote is not closed.' });
    expect(lex('echo "a"b')).toEqual({
      ok: false,
      error: 'Put a space after a closing double quote.',
    });
    expect(lex('echo a"b"')).toEqual({ ok: false, error: 'A double quote starts inside a word.' });
  });
});

describe('values', () => {
  it('reads levels as output or arc level', () => {
    expect(level('128')).toEqual({ ok: true, value: 128 });
    expect(level('100%')).toEqual({ ok: true, value: 254 });
    expect(level('0%')).toEqual({ ok: true, value: 0 });
    expect(level('10.1%')).toEqual({ ok: true, value: 170 });
    expect(level('101%').ok).toBe(false);
    expect(level('255').ok).toBe(false);
    expect(level('x').ok).toBe(false);
    expect(channel('254')).toEqual({ ok: true, value: 254 });
    expect(channel('255').ok).toBe(false);
  });

  it('reads colour temperatures, times and bytes', () => {
    expect(temperature('2700K')).toEqual({ ok: true, value: 370 });
    expect(temperature('6500k')).toEqual({ ok: true, value: 154 });
    expect(temperature('370m')).toEqual({ ok: true, value: 370 });
    expect(temperature('900K').ok).toBe(false);
    expect(temperature('0m').ok).toBe(false);
    expect(temperature('warm').ok).toBe(false);
    expect(time('300ms')).toEqual({ ok: true, value: 300 });
    expect(time('1.5s')).toEqual({ ok: true, value: 1500 });
    expect(time('16min')).toEqual({ ok: true, value: 960_000 });
    expect(time('17min').ok).toBe(false);
    expect(time('2').ok).toBe(false);
    expect(hexByte('ff')).toEqual({ ok: true, value: 255 });
    expect(hexByte('0x1F')).toEqual({ ok: true, value: 31 });
    expect(hexByte('g1').ok).toBe(false);
    expect(colour('#ff8000')).toEqual({ ok: true, value: [254, 128, 0] });
    expect(colour('#ff80').ok).toBe(false);
  });

  it('prints times for people', () => {
    expect(msText(300)).toBe('300 ms');
    expect(msText(2000)).toBe('2 s');
    expect(msText(1500)).toBe('1.5 s');
    expect(msText(60_000)).toBe('1 min');
    expect(msText(270_000)).toBe('4 min 30 s');
  });
});

describe('names', () => {
  it("uses python-dali's class names in kebab case", () => {
    expect(kebab('general.QueryActualLevel')).toBe('query-actual-level');
    expect(kebab('general.EnableDAPCSequence')).toBe('enable-dapc-sequence');
    expect(kebab('general.StoreActualLevelInDTR0')).toBe('store-actual-level-in-dtr0');
    expect(kebab('colour.QueryRBGWAFControl')).toBe('query-rbgwaf-control');
    expect(byName('Recall-Max-Level')?.id).toBe('RECALL_MAX_LEVEL');
    expect(byName('dtr0')?.id).toBe('DTR0');
    expect(byName('nope')).toBeUndefined();
  });

  it('reaches every command, with dt6- and dt8- for shared names', () => {
    const reached = new Set([...DALI_NAMES.values()].map((s) => s.id));
    for (const c of COMMANDS) expect(reached.has(c.id)).toBe(true);
    expect(byName('query-operating-mode')?.id).toBe('QUERY_OPERATING_MODE');
    expect(byName('dt6-query-operating-mode')?.id).toBe('DT6_QUERY_OPERATING_MODE');
    expect(byName('query-extended-version-number')).toBeUndefined();
    expect(byName('dt8-query-operating-mode')).toBeUndefined();
    expect(parseLine('query-extended-version-number 0', ctx)).toEqual({
      ok: false,
      error:
        '"query-extended-version-number" names commands for more than one device type. Type dt6-query-extended-version-number or dt8-query-extended-version-number.',
    });
    expect(byName('dt8-query-extended-version-number')?.id).toBe(
      'DT8_QUERY_EXTENDED_VERSION_NUMBER',
    );
    expect(byName('set-temporary-colour-temperature-tc')?.id).toBe('DT8_SET_TEMPORARY_TC');
    expect(nameOf('DT8_SET_TEMPORARY_TC')).toBe('set-temporary-colour-temperature');
    expect(nameOf('DT8_ACTIVATE')).toBe('activate');
    expect(nameOf('NOT_A_COMMAND')).toBe('not_a_command');
  });
});

describe('addresses', () => {
  it('reads every form', () => {
    expect(parseTarget('0', ctx)).toEqual({ ok: true, value: [short(0)] });
    expect(parseTarget('g15', ctx)).toEqual({ ok: true, value: [group(15)] });
    expect(parseTarget('ALL', ctx)).toEqual({ ok: true, value: [broadcast] });
    expect(parseTarget('unaddressed', ctx)).toEqual({ ok: true, value: [unaddressed] });
    expect(parseTarget('tw', ctx)).toEqual({ ok: true, value: [short(0)] });
    expect(parseTarget('0,g1,rgb1', ctx)).toEqual({
      ok: true,
      value: [short(0), group(1), short(1)],
    });
    expect(parseTarget('0..3', ctx)).toEqual({ ok: true, value: [0, 1, 2, 3].map(short) });
  });

  it('refuses what is not an address', () => {
    expect(parseTarget('64', ctx)).toEqual({
      ok: false,
      error: 'A short address is 0 to 63, not 64.',
    });
    expect(parseTarget('g16', ctx).ok).toBe(false);
    expect(parseTarget('3..1', ctx).ok).toBe(false);
    expect(parseTarget('0..64', ctx).ok).toBe(false);
    expect(parseTarget('x', ctx).ok).toBe(false);
    expect(parseTarget('0,all', ctx).ok).toBe(false);
    expect(parseTarget('', ctx).ok).toBe(false);
    expect(parseTarget(Array.from({ length: 65 }, () => '1').join(','), ctx)).toEqual({
      ok: false,
      error: 'A list names at most 64 addresses.',
    });
  });

  it('checks alias names', () => {
    expect(aliasProblem('tw')).toBeUndefined();
    expect(aliasProblem('1tw')).toBeDefined();
    expect(aliasProblem('g3')).toBe('"g3" is an address word.');
    expect(aliasProblem('all')).toBe('"all" is an address word.');
    expect(aliasProblem('level')).toBe('"level" is a command name.');
    expect(aliasProblem('dapc')).toBe('"dapc" is a command name.');
    expect(aliasProblem('recall')).toBe('"recall" is a keyword.');
  });
});

describe('friendly commands', () => {
  it('level, off, on', () => {
    expect(cmd('level 0 50%')).toEqual({ cmd: 'level', to: [short(0)], arc: 229 });
    expect(cmd('LEVEL tw 128 fade 2s')).toEqual({
      cmd: 'level',
      to: [short(0)],
      arc: 128,
      fadeMs: 2000,
    });
    expect(cmd('off all')).toEqual({ cmd: 'off', to: [broadcast] });
    expect(cmd('on g2')).toEqual({ cmd: 'on', to: [group(2)] });
    expect(err('level 0')).toBe('level needs a value, such as 35% or 128.');
    expect(err('level 0 50 fade')).toBe('After the level, only "fade <time>" may follow.');
    expect(err('level 0 50 fade 2')).toContain('Expected a time');
    expect(err('level')).toBe('level needs an address. Set a default with "use".');
    expect(err('level x 3')).toContain('"x" is not an address');
    expect(err('off 0 1')).toBe('Unexpected "1".');
  });

  it('uses the default address when the line leaves it out', () => {
    expect(cmd('level 3', withUse)).toEqual({ cmd: 'level', to: [short(0)], arc: 3 });
    expect(cmd('level 3 50%', withUse)).toEqual({ cmd: 'level', to: [short(3)], arc: 229 });
    expect(cmd('off', withUse)).toEqual({ cmd: 'off', to: [short(0)] });
    expect(cmd('tc 2700K', withUse)).toEqual({ cmd: 'tc', to: [short(0)], mirek: 370 });
    expect(cmd('scene recall 3', withUse)).toEqual({
      cmd: 'scene',
      to: [short(0)],
      op: 'recall',
      n: 3,
    });
    expect(err('level x', withUse)).toContain('Expected a level');
    expect(err('level 3 x', withUse)).toContain('Expected a level');
  });

  it('tc and rgb', () => {
    expect(cmd('tc 0 2700K 50%')).toEqual({ cmd: 'tc', to: [short(0)], mirek: 370, arc: 229 });
    expect(err('tc 0')).toBe('tc needs a colour temperature, such as 2700K.');
    expect(err('tc 0 2700K 1 2')).toBe('tc takes a temperature and an optional level.');
    expect(err('tc 0 2700K x')).toContain('Expected a level');
    expect(cmd('rgb 1 254 0 0')).toEqual({
      cmd: 'rgb',
      to: [short(1)],
      channels: [254, 0, 0, 0, 0, 0],
    });
    expect(cmd('rgb 1 0 0 0 w 10 a 20')).toEqual({
      cmd: 'rgb',
      to: [short(1)],
      channels: [0, 0, 0, 10, 20, 0],
    });
    expect(cmd('rgb 1 #ff0000 a 5')).toEqual({
      cmd: 'rgb',
      to: [short(1)],
      channels: [254, 0, 0, 0, 5, 0],
    });
    expect(err('rgb 1')).toBe('rgb needs three channel levels or #rrggbb.');
    expect(err('rgb 1 1 2')).toBe('rgb needs three channel levels: red, green and blue.');
    expect(err('rgb 1 1 2 300')).toContain('channel level');
    expect(err('rgb 1 1 2 3 w')).toContain('only "w <n>" and "a <n>"');
    expect(err('rgb 1 1 2 3 w 1 w 2')).toContain('once each');
    expect(err('rgb 1 1 2 3 w 300')).toContain('channel level');
    expect(err('rgb 1 #ff')).toContain('#rrggbb');
  });

  it('fade, scene and group', () => {
    expect(cmd('fade 0')).toEqual({ cmd: 'fade', to: [short(0)] });
    expect(cmd('fade 0 2s')).toEqual({ cmd: 'fade', to: [short(0)], ms: 2000 });
    expect(cmd('fade 0 rate 7')).toEqual({ cmd: 'fade', to: [short(0)], rate: 7 });
    expect(err('fade 0 rate')).toBe('fade rate needs a rate from 1 to 15.');
    expect(err('fade 0 rate 16')).toContain('fade rate');
    expect(err('fade 0 1s 2s')).toBe('fade takes one time, or "rate <n>".');
    expect(err('fade 0 x')).toContain('Expected a time');
    expect(cmd('scene 0 store 4 50%')).toEqual({
      cmd: 'scene',
      to: [short(0)],
      op: 'store',
      n: 4,
      arc: 229,
    });
    expect(cmd('scene 0 remove 4')).toEqual({ cmd: 'scene', to: [short(0)], op: 'remove', n: 4 });
    expect(cmd('scene 0 list')).toEqual({ cmd: 'scene', to: [short(0)], op: 'list' });
    expect(err('scene 0 list 1')).toBe('scene list takes nothing more.');
    expect(err('scene 0 go 1')).toBe('scene needs recall, store, remove or list.');
    expect(err('scene 0 recall')).toBe('scene recall needs a scene number from 0 to 15.');
    expect(err('scene 0 recall 16')).toContain('scene number');
    expect(err('scene 0 recall 1 2')).toBe('scene recall takes a scene number only.');
    expect(err('scene 0 store 1 2 3')).toBe('scene store takes a scene and an optional level.');
    expect(err('scene 0 store 1 x')).toContain('Expected a level');
    expect(cmd('group 0 add g3')).toEqual({ cmd: 'group', to: [short(0)], op: 'add', n: 3 });
    expect(cmd('group 0 remove 15')).toEqual({ cmd: 'group', to: [short(0)], op: 'remove', n: 15 });
    expect(err('group 0 join 1')).toContain('add or remove');
    expect(err('group 0 add 16')).toContain('group number');
  });

  it('query', () => {
    expect(cmd('query 0')).toEqual({ cmd: 'query', to: [short(0)], what: 'summary' });
    expect(cmd('query 0 level')).toEqual({
      cmd: 'query',
      to: [short(0)],
      what: { id: 'QUERY_ACTUAL_LEVEL' },
    });
    expect(cmd('query 0 status')).toEqual({
      cmd: 'query',
      to: [short(0)],
      what: { id: 'QUERY_STATUS' },
    });
    expect(cmd('query 0 query-max-level')).toEqual({
      cmd: 'query',
      to: [short(0)],
      what: { id: 'QUERY_MAX_LEVEL' },
    });
    expect(cmd('query 0 tc')).toEqual({ cmd: 'query', to: [short(0)], what: 'tc' });
    expect(err('query 0 nonsense')).toContain('not something query can ask');
    expect(err('query 0 short-address')).toContain('not something query can ask');
    expect(err('query 0 a b')).toBe('query takes one thing to ask.');
    // A query that takes a number or reads a DTR needs its own command (S6-D8).
    expect(err('query 0 scene-level')).toContain('needs a value set first');
    expect(err('query 0 colour-value')).toContain('needs a value set first');
    expect(err('query 0 dt8-query-colour-value')).toContain('needs a value set first');
    expect(cmd('query 0 dt6-query-operating-mode')).toMatchObject({
      what: { id: 'DT6_QUERY_OPERATING_MODE' },
    });
  });

  it('commands with no arguments', () => {
    for (const c of ['devices', 'scan', 'panic', 'resume', 'scripts', 'clear'])
      expect(cmd(c)).toEqual({ cmd: c });
    expect(err('scan now')).toBe('scan takes nothing more.');
  });

  it('profile, cap, target, trace', () => {
    expect(cmd('profile')).toEqual({ cmd: 'profile' });
    expect(cmd('profile apply')).toEqual({ cmd: 'profile', apply: true });
    expect(cmd('profile 1')).toEqual({ cmd: 'profile', to: [short(1)] });
    expect(err('profile 1 2')).toBe('profile takes an address, or "apply".');
    expect(err('profile x')).toContain('not an address');
    expect(cmd('cap')).toEqual({ cmd: 'cap' });
    expect(cmd('cap 40%')).toEqual({ cmd: 'cap', arc: 220 });
    expect(cmd('cap 200')).toEqual({ cmd: 'cap', arc: 200 });
    expect(err('cap 0')).toContain('arc level');
    expect(err('cap 0.01%')).toContain('below the lowest');
    expect(err('cap 120%')).toContain('0% to 100%');
    expect(err('cap 1 2')).toContain('one value');
    expect(cmd('target')).toEqual({ cmd: 'target' });
    expect(cmd('target hw')).toEqual({ cmd: 'target', target: 'hardware' });
    expect(cmd('target Both')).toEqual({ cmd: 'target', target: 'both' });
    expect(err('target moon')).toBe('target takes sim, hw or both.');
    expect(cmd('trace')).toEqual({ cmd: 'trace' });
    expect(cmd('trace off')).toEqual({ cmd: 'trace', on: false });
    expect(err('trace maybe')).toBe('trace takes on or off.');
  });

  it('reads only its own words from its tables (SH-1)', () => {
    for (const w of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(err(`target ${w}`), w).toBe('target takes sim, hw or both.');
      expect(err(`query 0 ${w}`), w).toMatch(/is not something query can ask/);
      expect(err(`explain query 0 ${w}`), w).toMatch(/is not something query can ask/);
    }
  });

  it('explain takes one line that sends DALI frames itself', () => {
    expect(cmd('explain tc 0 3000K 30%')).toEqual({
      cmd: 'explain',
      line: 'tc 0 3000K 30%',
      inner: cmd('tc 0 3000K 30%'),
    });
    expect(cmd('explain   dapc 0 128   # why')).toEqual({
      cmd: 'explain',
      line: 'dapc 0 128',
      inner: { cmd: 'dali', id: 'DAPC', to: [short(0)], value: 128 },
    });
    expect(cmd('explain raw a3 4d')).toMatchObject({ inner: { cmd: 'raw', a: 0xa3, b: 0x4d } });
    expect(cmd('EXPLAIN off all')).toMatchObject({ inner: { cmd: 'off', to: [broadcast] } });
    // The inner line's own errors come back as they are.
    expect(err('explain level 0')).toBe(err('level 0'));
    expect(err('explain frob')).toBe(err('frob'));
    expect(err('explain')).toBe('explain takes a command, such as explain tc 0 3000K.');
    const not =
      'explain covers commands that send DALI frames themselves: level, off, on, tc, rgb, fade, scene, group, query, raw and any DALI command by name.';
    for (const c of ['cap 40%', 'scan', 'panic', 'unlock reset', 'target hw', 'wait 2s', 'help'])
      expect(err(`explain ${c}`)).toBe(`${not} For ${c.split(' ')[0] ?? ''}, see help.`);
    expect(err('explain explain off 0')).toBe(`${not} For explain, see help.`);
    expect(err('explain # nothing')).toBe('explain takes a command, such as explain tc 0 3000K.');
  });

  it('unlock, lock, run, history, help, echo, wait, pause, use, raw', () => {
    expect(cmd('unlock reset')).toEqual({ cmd: 'unlock', name: 'reset' });
    expect(err('unlock')).toBe('unlock takes rate, reset or expert.');
    expect(cmd('lock')).toEqual({ cmd: 'lock' });
    expect(cmd('lock rate')).toEqual({ cmd: 'lock', name: 'rate' });
    expect(err('lock all')).toBe('lock takes rate, reset or expert.');
    expect(cmd('run first-light')).toEqual({ cmd: 'run', name: 'first-light' });
    expect(cmd('run "my script"')).toEqual({ cmd: 'run', name: 'my script' });
    expect(err('run')).toBe('run takes the name of a script.');
    expect(cmd('history -c')).toEqual({ cmd: 'history', args: ['-c'] });
    expect(cmd('help')).toEqual({ cmd: 'help' });
    expect(cmd('help Keys')).toEqual({ cmd: 'help', topic: 'keys' });
    expect(err('help a b')).toBe('help takes one topic, or -k and a word to look for.');
    expect(cmd('help -k Fade')).toEqual({ cmd: 'help', find: 'fade' });
    expect(err('help -k')).toBe('help -k takes one word to look for.');
    expect(err('help -k a b')).toBe('help -k takes one word to look for.');
    expect(cmd('echo "hello  there" you')).toEqual({ cmd: 'echo', text: 'hello  there you' });
    expect(cmd('wait 2s')).toEqual({ cmd: 'wait', ms: 2000 });
    expect(err('wait')).toBe('wait takes one time, such as 2s.');
    expect(err('wait 2')).toContain('Expected a time');
    expect(cmd('pause')).toEqual({ cmd: 'pause' });
    expect(cmd('pause "Look now"')).toEqual({ cmd: 'pause', text: 'Look now' });
    expect(err('pause a b')).toContain('one message');
    expect(cmd('use')).toEqual({ cmd: 'use' });
    expect(cmd('use g1')).toEqual({ cmd: 'use', to: [group(1)] });
    expect(err('use x')).toContain('not an address');
    expect(err('use 1 2')).toBe('use takes one address.');
    expect(cmd('raw ff 00')).toEqual({ cmd: 'raw', a: 255, b: 0, twice: false });
    expect(cmd('raw 0x01 0x20 X2')).toEqual({ cmd: 'raw', a: 1, b: 32, twice: true });
    expect(err('raw ff')).toContain('two bytes');
    expect(err('raw ff 00 x3')).toBe('Expected x2, not "x3".');
    expect(err('raw fff 00')).toContain('byte in hex');
    expect(err('raw ff zz')).toContain('byte in hex');
  });

  it('blank lines, comments and errors', () => {
    expect(parseLine('', ctx)).toEqual({ ok: true });
    expect(parseLine('   # just a note', ctx)).toEqual({ ok: true });
    expect(err('"level" 0 1')).toBe('A line starts with a command name.');
    expect(err('frobnicate')).toBe('Unknown command "frobnicate". Type "help" for the list.');
    expect(err('echo "x')).toBe('A double quote is not closed.');
    expect(err('x'.repeat(501))).toBe('A line is at most 500 characters.');
  });
});

describe('DALI commands by name', () => {
  it('addressed commands, with values where the command takes one', () => {
    expect(cmd('dapc 0 128')).toEqual({ cmd: 'dali', id: 'DAPC', to: [short(0)], value: 128 });
    expect(cmd('dapc 0 mask')).toEqual({ cmd: 'dali', id: 'DAPC', to: [short(0)], value: 255 });
    expect(cmd('dapc all 50%')).toEqual({ cmd: 'dali', id: 'DAPC', to: [broadcast], value: 229 });
    expect(cmd('recall-max-level 0')).toEqual({
      cmd: 'dali',
      id: 'RECALL_MAX_LEVEL',
      to: [short(0)],
    });
    expect(cmd('go-to-scene 0 3')).toEqual({
      cmd: 'dali',
      id: 'GO_TO_SCENE',
      to: [short(0)],
      value: 3,
    });
    expect(cmd('add-to-group 1 g4')).toEqual({
      cmd: 'dali',
      id: 'ADD_TO_GROUP',
      to: [short(1)],
      value: 4,
    });
    expect(cmd('query-actual-level 0..1')).toEqual({
      cmd: 'dali',
      id: 'QUERY_ACTUAL_LEVEL',
      to: [short(0), short(1)],
    });
    expect(cmd('activate 0')).toEqual({ cmd: 'dali', id: 'DT8_ACTIVATE', to: [short(0)] });
    expect(cmd('set-max-level', withUse)).toEqual({
      cmd: 'dali',
      id: 'SET_MAX_LEVEL',
      to: [short(0)],
    });
    expect(err('dapc 0')).toBe('DAPC needs one level.');
    expect(err('go-to-scene 0')).toBe('GO TO SCENE needs a number from 0 to 15.');
    expect(err('go-to-scene 0 16')).toContain('number from 0 to 15');
    expect(err('off-x 0')).toContain('Unknown command');
    expect(err('recall-max-level 0 1')).toBe('Unexpected "1".');
  });

  it('special commands, which take a data byte and no address', () => {
    expect(cmd('dtr0 220')).toEqual({ cmd: 'dali', id: 'DTR0', value: 220 });
    expect(cmd('dtr1 0xff')).toEqual({ cmd: 'dali', id: 'DTR1', value: 255 });
    expect(cmd('terminate')).toEqual({ cmd: 'dali', id: 'TERMINATE' });
    expect(cmd('initialise all')).toEqual({ cmd: 'dali', id: 'INITIALISE', value: 0 });
    expect(cmd('initialise unaddressed')).toEqual({ cmd: 'dali', id: 'INITIALISE', value: 255 });
    expect(cmd('initialise 5')).toEqual({ cmd: 'dali', id: 'INITIALISE', value: 11 });
    expect(cmd('program-short-address 3')).toEqual({
      cmd: 'dali',
      id: 'PROGRAM_SHORT_ADDRESS',
      value: 7,
    });
    expect(cmd('program-short-address none')).toEqual({
      cmd: 'dali',
      id: 'PROGRAM_SHORT_ADDRESS',
      value: 255,
    });
    expect(err('terminate 1')).toBe('TERMINATE takes no address or value.');
    expect(err('dtr0')).toBe('DTR0 takes one value.');
    expect(err('dtr0 256')).toContain('a byte');
    expect(err('dtr0 0xzz')).toContain('byte in hex');
    expect(err('initialise 64')).toContain('Or "all" or "unaddressed"');
    expect(err('program-short-address 64')).toContain('Or "none"');
  });

  it('every command in the table parses with a valid address and value', () => {
    for (const s of COMMANDS) {
      const name = nameOf(s.id);
      const line =
        s.kind === 'special'
          ? s.param === 'none'
            ? name
            : `${name} 1`
          : s.kind === 'dapc' || s.param === 'nibble'
            ? `${name} 0 1`
            : `${name} 0`;
      const r = parseLine(line, ctx);
      expect([line, r.ok]).toEqual([line, true]);
      // A friendly command of the same name (off) does the same thing.
      if ((FRIENDLY as readonly string[]).includes(name)) continue;
      expect(r.ok && r.command?.cmd === 'dali' && spec(r.command.id).id).toBe(s.id);
    }
  });
});
