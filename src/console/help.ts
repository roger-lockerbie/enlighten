/**
 * Console help (SPEC section 6): `help` lists the commands, `help <command>` explains one, whether
 * it is one of the console's own or a DALI command by name, `help -k <word>` looks a word up, and
 * `help keys` prints the binding table as it applies on this platform (ADR 0006, ADR 0023).
 *
 * For a DALI command, only the sentence saying what it does is written by hand (`dali-help.ts`).
 * Its syntax, frame, reply, registers and example come from the command table, and the governor's
 * line from the rule table, so help cannot say something the app does not do.
 */
import { short } from '../dali/address.ts';
import { frameText, type Command } from '../dali/codec.ts';
import { COMMANDS, type CommandSpec } from '../dali/commands.ts';
import { framesFor } from '../dali/sequences.ts';
import { LIGHT_CHANGING, ruleFor, UNVERIFIED_OK, type Rule } from '../safety/rules.ts';
import { DALI_HELP, GROUP_TITLES, type DaliGroup } from './dali-help.ts';
import { legend, type Platform } from './keys.ts';
import { byName, nameOf, sharedNames } from './names.ts';
import { lineOf } from './unparse.ts';

/** What help was asked: nothing, a topic, or a word to look for. */
export type HelpAsk = string | undefined | { readonly find: string };

const EXPLAIN_TIP = 'explain <line> lists the frames a line would send, without sending them.';

const TOPICS: Readonly<Record<string, readonly string[]>> = {
  level: [
    'level <addr> <value> [fade <time>]',
    'Sets the level. 35% is output, a bare number is an arc level 0 to 254. A fade is set first.',
    'The governor holds every level to the ceiling.',
    'Sends DAPC. With a fade it first sends DTR0 and SET FADE TIME, or SET EXTENDED FADE TIME.',
  ],
  off: ['off <addr>', 'Turns the address off. Sends OFF.'],
  on: ['on <addr>', 'Goes back to the last level it had. Sends GO TO LAST ACTIVE LEVEL.'],
  tc: [
    'tc <addr> <temperature> [<value>]',
    'Colour temperature, as 2700K or 370m, with an optional level in the same fade.',
    'Sends DTR0 and DTR1 (the temperature in mirek), SET TEMPORARY COLOUR TEMPERATURE Tc, then',
    'ACTIVATE, a DAPC, or both.',
  ],
  rgb: [
    'rgb <addr> <r> <g> <b> [w <n>] [a <n>]   or   rgb <addr> #rrggbb [w <n>] [a <n>]',
    'Channel levels 0 to 254. w is the first white, a the second. Whites not given are off.',
    'Sends DTR0 to DTR2 and SET TEMPORARY RGB DIMLEVEL, the same for SET TEMPORARY WAF DIMLEVEL,',
    'then ACTIVATE.',
  ],
  fade: [
    'fade <addr>   fade <addr> <time>   fade <addr> rate <n>',
    'Shows the fade, or sets the nearest fade time the driver has and says which. A rate is 1 to 15.',
    'Sends DTR0 with SET FADE TIME, SET EXTENDED FADE TIME or SET FADE RATE, or the two fade queries.',
  ],
  scene: [
    'scene <addr> recall <n>   scene <addr> store <n> [<value>]   scene <addr> remove <n>   scene <addr> list',
    'Scenes 0 to 15. store keeps the present level, or the one given, and reads it back.',
    'Sends GO TO SCENE, DTR0 with SET SCENE, REMOVE FROM SCENE, or QUERY SCENE LEVEL.',
  ],
  group: [
    'group <addr> add <n>   group <addr> remove <n>',
    'Group membership, 0 to 15. Sends ADD TO GROUP or REMOVE FROM GROUP.',
  ],
  query: [
    'query <addr> [<what>]',
    'One value, or a summary. <what> is level, max, min, phm, power-on, failure, type, fade, groups, tc,',
    'or any query command without "query-", such as actual-level or status.',
  ],
  devices: ['devices', 'Lists the inventory.'],
  scan: ['scan', 'Scans the bus again and writes the safety profile.'],
  profile: [
    'profile [<addr>]   profile apply',
    "Shows the safety profile's state, or writes it again.",
  ],
  cap: [
    'cap [<value>]',
    'Shows or sets the ceiling, as 40% or an arc level. Lowering takes effect at once.',
    'Raising asks you to type the new value. A script cannot raise it.',
  ],
  target: [
    'target [sim | hw | both]',
    'Shows or sets the output target. Changing it stops scripts.',
  ],
  trace: ['trace [on | off]', 'Shows every frame in the console as it is sent.'],
  panic: ['panic', 'Stops everything and turns every light off. Escape twice does the same.'],
  resume: ['resume', 'Releases the panic latch. Nothing is sent by resuming.'],
  unlock: ['unlock rate | reset | expert', 'A session unlock. You type its name to confirm.'],
  lock: ['lock [<name>]', 'Drops one unlock, or all of them.'],
  run: [
    'run <script>',
    'Runs a script. Enter continues at a pause. Ctrl-C stops it, and so does panic.',
  ],
  history: [
    'history [<first> [<last>]] [-n] [-r] [-i]   history -c',
    'Lists history: the last 16, or a range. -n drops numbers, -r reverses, -i adds times.',
    '-c clears it, after you type yes. Expansion: !! !n !-n !prefix !?text? ^old^new, and :p to print only.',
  ],
  clear: ['clear', 'Clears the output. Ctrl-L does the same.'],
  help: [
    'help [<topic>]   help -k <word>',
    'Topics: every command of the console, every DALI command by name, and keys, addresses, values,',
    'dali, hardware and scripts. help -k looks a word up in all of them.',
  ],
  explain: [
    'explain <line>',
    'Shows what a line would send, and sends nothing: each DALI command as a line you could type,',
    'its frames in hex, and its name in the standard. It covers level, off, on, tc, rgb, fade,',
    'scene, group, query, raw and any DALI command by name.',
    'It reads the target and what the app knows of the driver, as the real line would, so the same',
    'line can explain differently on the simulator and on hardware.',
    'It does not ask the governor, which may clamp, hold or refuse the line when it is sent.',
    'To see frames as they are sent: trace on, or the Bus monitor page.',
  ],
  echo: ['echo <text>', 'Prints the text.'],
  wait: ['wait <time>', 'Waits, as 300ms, 2s or 25min. Ctrl-C ends the wait.'],
  pause: ['pause ["message"]', 'In a script: shows the message and waits for Enter.'],
  use: [
    'use [<addr>]',
    'Sets a default address, after which it may be left out. use alone clears it.',
  ],
  raw: [
    'raw <hex> <hex> [x2]',
    'Sends one 16-bit frame as given, twice with x2. The governor judges it like any frame.',
  ],
  addresses: [
    'Addresses: 0 to 63 a short address, g0 to g15 a group, all for broadcast,',
    'unaddressed for gear without a short address, an alias from the Devices page,',
    'and 0,1 or 0..3 for a list or range, sent in order.',
  ],
  values: [
    'Values: 35% is output. A bare number is an arc level or channel level, 0 to 254.',
    '2700K is kelvin and 370m is mirek. Times are 300ms, 2s and 25min.',
  ],
  hardware: [
    'On the Hardware and Both targets the governor trusts nothing about real gear until it has',
    'been tried (ADR 0019, ADR 0022). Until then, besides its usual rules:',
    '  It allows about one change of light every 2 seconds to an address, OFF included.',
    '  A change of light goes to one short address. To a group or to all, only OFF is allowed.',
    '  Colour gear takes its colour before its level: a level alone is refused while the app',
    '  does not know which colour the driver holds. tc and rgb send them in that order.',
    '  A colour changes only with no fade, and so does a level on colour gear. Its fade time and',
    '  extended fade time must read back as 0.',
    '  UP, DOWN, CONTINUOUS UP, CONTINUOUS DOWN and a DAPC sequence are refused to colour gear.',
    '  A fade setting counts only as read back from the driver.',
    'The refusal says which rule it was. The DA5-L on the bench is colour gear.',
  ],
  scripts: [
    'scripts lists the scripts. The Scripts page edits, imports and exports them.',
    'A script is one command a line, with wait <time>, pause "message", echo <text>,',
    'repeat <n> ... end (1 to 1000, nested twice at most) and # comments.',
    'Not in a script: unlock, lock, target, run, history, clear, use, resume, scripts, explain,',
    'and cap with a value above the ceiling.',
  ],
};

export const HELP_TOPICS: readonly string[] = [...Object.keys(TOPICS), 'dali', 'keys'];

const WIDTH = 96;

/** Break words into lines of at most WIDTH characters. */
function wrap(text: string | readonly string[], indent = '', gap = ' '): string[] {
  const out: string[] = [];
  let line = indent;
  for (const w of typeof text === 'string' ? text.split(' ') : text) {
    if (line.length > indent.length && line.length + gap.length + w.length > WIDTH) {
      out.push(line);
      line = indent;
    }
    line += (line.length > indent.length ? gap : '') + w;
  }
  if (line.length > indent.length) out.push(line);
  return out;
}

const PART: Readonly<Record<0 | 6 | 8, string>> = {
  0: 'IEC 62386-102',
  6: 'IEC 62386-207',
  8: 'IEC 62386-209',
};

/** What the governor does with each rule (SPEC section 5), in the words of `applyRule`. */
const RULE_TEXT: Readonly<Record<Rule, string>> = {
  allow: 'Allowed.',
  dapc: 'A level above the ceiling is clamped to it.',
  off: 'Allowed.',
  'verified-down': '',
  'verified-up': '',
  'enable-dapc-sequence':
    'On Hardware and Both it is refused to gear that may be colour gear (ADR 0022).',
  'set-max': 'Refused when DTR0 is above the ceiling. 255 counts as 254.',
  'set-min': 'Refused when DTR0 is above the ceiling.',
  'set-scene':
    'Refused when DTR0 is a level above the ceiling. 255 is accepted. A temporary colour that would be stored with it is judged too.',
  'set-power-on':
    'Refused when DTR0 is 255 or above the ceiling. A temporary colour that would be stored with it is judged too.',
  'set-fade': '',
  membership: '',
  'gear-writes': 'Allowed.',
  'temp-tc': 'Refused unless the gear reports colour temperature control.',
  'temp-rgbwaf': 'Refused unless the gear reports RGBWAF channels.',
  'rgbwaf-control': 'Only channel control is allowed: DTR0 with its top two bits 0.',
  activate: 'The colour it brings in is judged with the level.',
  'refuse-colour-type': 'Refused: the DA5-L is not known to report this colour type.',
  expert:
    'Needs the expert unlock, and a person at the console or the UI. A script cannot send it.',
  'expert-curve':
    'Needs the expert unlock, and a person at the console or the UI. A script cannot send it.',
  reset:
    'Needs the reset unlock and a person. The console then runs the reset of the app: RESET, OFF about 0.35 s later, and the safety profile written again.',
  commissioning:
    'Needs the reset unlock, and a person at the console or the UI. A script cannot send it.',
  refuse: 'Refused always.',
};

/** Rules that are judged on their own terms, not by whether the gear is verified (`applyRule`). */
const BY_UNLOCK: ReadonlySet<Rule> = new Set<Rule>([
  'reset',
  'commissioning',
  'expert',
  'expert-curve',
  'refuse',
  'refuse-colour-type',
]);

/** The governor's line for a command. */
export function governorText(s: CommandSpec): string {
  const rule = ruleFor(s.id, s.reply !== 'none');
  const verified =
    s.kind !== 'special' && !UNVERIFIED_OK.has(rule) && !BY_UNLOCK.has(rule)
      ? 'Needs gear whose safety profile is verified.'
      : '';
  const open =
    s.kind !== 'special' && UNVERIFIED_OK.has(rule) ? 'Unverified gear takes it too.' : '';
  // What the rule table does not say: the rate guard and, on real gear, the holding rules.
  const light =
    LIGHT_CHANGING.has(s.id) && rule !== 'refuse'
      ? 'It changes the light, so the rate guard can hold or refuse it, and on Hardware and Both the holding rules apply: help hardware.'
      : '';
  return [verified, RULE_TEXT[rule], open, light].filter((x) => x !== '').join(' ');
}

/** A command with sample arguments, for the example line. */
function sample(s: CommandSpec): Command {
  if (s.kind === 'special') {
    const value =
      s.param === 'none'
        ? undefined
        : s.param === 'shortAddress'
          ? (5 << 1) | 1
          : s.param === 'initialise'
            ? 0
            : s.id === 'ENABLE_DEVICE_TYPE'
              ? 8
              : s.id.startsWith('SEARCHADDR')
                ? 255
                : 128;
    return value === undefined ? { id: s.id } : { id: s.id, value };
  }
  if (s.kind === 'dapc') return { id: s.id, address: short(0), value: 128 };
  if (s.param === 'nibble') return { id: s.id, address: short(0), value: 3 };
  return { id: s.id, address: short(0) };
}

function usage(s: CommandSpec, name: string): string {
  if (s.kind === 'special') {
    if (s.param === 'byte') return `${name} <0 to 255>`;
    if (s.param === 'shortAddress') return `${name} <0 to 63 | none>`;
    if (s.param === 'initialise') return `${name} <all | unaddressed | 0 to 63>`;
    return name;
  }
  if (s.kind === 'dapc') return `${name} <addr> <0 to 254 | mask>`;
  if (s.param === 'nibble') return `${name} <addr> <0 to 15>`;
  return `${name} <addr>`;
}

function frameLine(s: CommandSpec): string {
  const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;
  const reply =
    s.reply === 'none'
      ? 'No reply.'
      : s.reply === 'yesno'
        ? 'Reply: yes, or silence for no.'
        : 'Reply: one byte.';
  if (s.kind === 'dapc')
    return `Frame: the address byte with its lowest bit 0, then the level. ${reply}`;
  if (s.kind === 'special') {
    const data = s.param === 'none' ? '0x00' : 'the value';
    return `Frame: ${hex(s.opcode)}, then ${data}. Every gear on the bus hears it. ${reply}`;
  }
  const op =
    s.param === 'nibble'
      ? `${hex(s.opcode)} plus the number`
      : `${hex(s.opcode)} (command ${String(s.opcode)})`;
  const dt =
    s.deviceType === 0
      ? ''
      : ` ENABLE DEVICE TYPE ${String(s.deviceType)} goes first, added for you.`;
  return `Frame: the address byte, then ${op}.${dt} ${reply}`;
}

/** Help for one DALI command. `typed` is the name as it was asked for. */
export function daliHelp(s: CommandSpec, typed?: string): string[] {
  const name = typed !== undefined && byName(typed) === s ? typed.toLowerCase() : nameOf(s.id);
  const h = DALI_HELP[s.id];
  const out: string[] = [`${usage(s, name)}     ${s.label}, ${PART[s.deviceType]}`];
  if (h !== undefined) out.push(...wrap(h.does));
  if (h?.general === true)
    out.push(
      ...wrap(
        "The project's research notes do not describe this command, so that line is from general knowledge of the standard.",
      ),
    );
  out.push(...wrap(frameLine(s)));
  const regs: string[] = [];
  if (s.reads.length > 0)
    regs.push(
      `Reads ${s.reads.map((r) => `DTR${String(r)}`).join(', ')}: set ${s.reads.length === 1 ? 'it' : 'them'} first.`,
    );
  if (s.sets !== undefined) regs.push(`Sets DTR${String(s.sets)}.`);
  if (s.gearWrites.length > 0)
    regs.push(
      `The gear may write ${s.gearWrites.map((r) => `DTR${String(r)}`).join(', ')}, which the app then treats as unknown.`,
    );
  if (s.sendTwice) regs.push('Sent twice within 100 ms, which the app does for you.');
  if (regs.length > 0) out.push(...wrap(regs.join(' ')));
  out.push(...wrap(`Governor: ${governorText(s)}`));
  if (h?.see !== undefined) out.push(...wrap(`See also: ${h.see}`));
  const eg = sample(s);
  const frames = framesFor(eg)
    .map((f) => frameText(f.frame))
    .join(', ');
  out.push(`Example: ${lineOf(eg)}     (${frames})`);
  return out;
}

const GROUP_ORDER: readonly DaliGroup[] = [
  'level',
  'config',
  'query',
  'register',
  'address',
  'memory',
  'dt6',
  'dt8',
];

/** `help dali`: how the names work, and every command by group. */
function daliOverview(): string[] {
  const out = [
    "Every DALI command the app supports can be typed by name: python-dali's class name in kebab",
    'case. dapc 0 128, recall-max-level 0, dtr0 220, set-max-level 0, query-actual-level 0.',
    'Device type commands get ENABLE DEVICE TYPE added, and send-twice commands go twice.',
    'dt6- or dt8- before a name reaches the device type command. A general command keeps a name it',
    'shares, and a name only device type commands share needs the prefix.',
    'help <name> says what a command does. help -k <word> looks a word up.',
    EXPLAIN_TIP,
  ];
  for (const group of GROUP_ORDER) {
    const names = COMMANDS.filter((c) => DALI_HELP[c.id]?.group === group).map((c) => nameOf(c.id));
    out.push(`${GROUP_TITLES[group]} (${String(names.length)}):`);
    out.push(...wrap(names, '  ', '  '));
  }
  return out;
}

const FIND_LIMIT = 30;

/** Typed text as help repeats it: one line, and short, so it cannot pass for help's own text. */
const said = (text: string) => text.replace(/\s+/g, ' ').slice(0, 40);

/** `help -k <word>`: topics and DALI commands whose name or text has the word. */
function find(word: string): string[] {
  const w = word.toLowerCase();
  const hits: string[] = [];
  const cap = (l: string) => (l.length > WIDTH ? `${l.slice(0, WIDTH - 4).trimEnd()} ...` : l);
  for (const [name, lines] of Object.entries(TOPICS))
    if (name.includes(w) || lines.some((l) => l.toLowerCase().includes(w)))
      hits.push(cap(`${name.padEnd(12)} ${lines[0] ?? ''}`));
  for (const c of COMMANDS) {
    const h = DALI_HELP[c.id];
    const name = nameOf(c.id);
    const text = `${name} ${c.label} ${h?.does ?? ''}`.toLowerCase();
    if (!text.includes(w)) continue;
    const first = `${name}: ${((h?.does ?? c.label).split('. ')[0] ?? '').replace(/\.$/, '')}.`;
    hits.push(cap(first));
  }
  if (hits.length === 0) return [`Nothing in help mentions "${said(word)}".`];
  const shown = hits.slice(0, FIND_LIMIT);
  if (hits.length > FIND_LIMIT)
    shown.push(`${String(hits.length - FIND_LIMIT)} more. Try a longer word.`);
  shown.push('help <name> says more about any of these.');
  return shown;
}

/** Help as lines of text. */
export function help(ask: HelpAsk, platform: Platform): string[] {
  if (typeof ask === 'object') return find(ask.find);
  const topic = ask;
  if (topic === undefined || topic === '') {
    return [
      'Commands: level off on tc rgb fade scene group query devices scan profile cap target trace',
      '  panic resume unlock lock run scripts history clear help explain echo wait use raw',
      'Every DALI command by name: help dali, then help <name>. To look a word up: help -k <word>.',
      'Keys: help keys. Addresses and values: help addresses, help values. Real gear: help hardware.',
      EXPLAIN_TIP,
      'Escape twice is panic from anywhere.',
    ];
  }
  if (topic === 'dali') return daliOverview();
  if (topic === 'keys') {
    const rows = legend(platform);
    const out = rows.map((r) => {
      const keys = r.keys.join(', ');
      const also =
        r.elsewhere.length > 0
          ? ` (also ${r.elsewhere.join(', ')} on a Mac or in an app window)`
          : '';
      return `${keys.padEnd(36)} ${r.does}${also}`;
    });
    if (platform === 'other')
      out.push(
        'Ctrl-W, Ctrl-N and Ctrl-T belong to the browser in a normal tab. An app window frees them.',
      );
    return out;
  }
  // An own topic only: `constructor` and the like are not topics (SH-1).
  const t = Object.hasOwn(TOPICS, topic) ? TOPICS[topic] : undefined;
  const s = byName(topic);
  // `off` is both: the console's own command, and the DALI command it sends.
  if (t !== undefined) return s === undefined ? [...t] : [...t, '', ...daliHelp(s, topic)];
  if (s !== undefined) return daliHelp(s, topic);
  const shared = sharedNames(topic);
  if (shared !== undefined)
    return [
      `${said(topic)} names commands for more than one device type. Try help ${shared.join(' or help ')}.`,
    ];
  return [`No help for "${said(topic)}". Type help for the list, or help -k to look a word up.`];
}
