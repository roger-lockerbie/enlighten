/** U-console: help for DALI commands, the word search, and the line that sends each command. */
import { describe, expect, it } from 'vitest';
import { COMMANDS, spec } from '../dali/commands.ts';
import { ruleFor } from '../safety/rules.ts';
import { DALI_HELP, GROUP_TITLES } from './dali-help.ts';
import { daliHelp, governorText, help } from './help.ts';
import { DALI_NAMES, nameOf } from './names.ts';
import { parseLine, type ParseContext } from './parse.ts';

const ctx: ParseContext = { aliases: new Map() };
const WIDTH = 96;

describe('help for DALI commands', () => {
  it('has an entry for every command in the table, and for nothing else', () => {
    expect(Object.keys(DALI_HELP).sort()).toEqual(COMMANDS.map((c) => c.id).sort());
    for (const h of Object.values(DALI_HELP)) expect(GROUP_TITLES[h.group]).toBeDefined();
  });

  it('writes each description as plain sentences', () => {
    const banned =
      /[–—]|\b(very|really|truly|extremely|absolutely|literally|basically|obviously|clearly|leverage|canonical|legible|quietly|in order to|prior to)\b/i;
    for (const [id, h] of Object.entries(DALI_HELP)) {
      expect(h.does.endsWith('.'), id).toBe(true);
      expect(banned.test(h.does), id).toBe(false);
      expect(h.does.length, id).toBeLessThanOrEqual(420);
      if (h.see !== undefined) expect(banned.test(h.see), id).toBe(false);
    }
  });

  it('answers for every name the console accepts, with the name of the standard and its part', () => {
    for (const [name, s] of DALI_NAMES) {
      const lines = help(name, 'other');
      // `off` is also one of the console's own commands, whose help comes first.
      const head = lines.find((l) => /IEC 62386-(102|207|209)$/.test(l)) ?? '';
      expect(head, name).toContain(name);
      expect(head, name).toContain(s.label);
      expect(lines.join('\n'), name).toContain(DALI_HELP[s.id]?.does.slice(0, 30) ?? 'missing');
      for (const l of lines)
        if (l !== head) expect(l.length, `${name}: ${l}`).toBeLessThanOrEqual(WIDTH + 4);
    }
    expect(help('QUERY-ACTUAL-LEVEL', 'other')[0]).toContain('query-actual-level <addr>');
  });

  it('gives an example that parses to the command it is help for', () => {
    for (const s of COMMANDS) {
      const eg = daliHelp(s).find((l) => l.startsWith('Example: '));
      const line = eg?.slice('Example: '.length).split('     ')[0] ?? '';
      const p = parseLine(line, ctx);
      // `off 0` is the console's own off, which sends OFF.
      const id = !p.ok ? p : p.command?.cmd === 'dali' ? p.command.id : p.command?.cmd;
      expect(id, line).toBe(s.id === 'OFF' ? 'off' : s.id);
    }
  });

  it('shows the frame, the reply, the registers and send-twice from the command table', () => {
    const text = (id: string) => daliHelp(spec(id)).join(' ');
    expect(text('QUERY_ACTUAL_LEVEL')).toContain('0xA0 (command 160). Reply: one byte.');
    expect(text('QUERY_LAMP_FAILURE')).toContain('Reply: yes, or silence for no.');
    expect(text('SET_MAX_LEVEL')).toContain('Reads DTR0: set it first. Sent twice within 100 ms');
    expect(text('DTR1')).toContain('Sets DTR1.');
    expect(text('DT8_QUERY_COLOUR_VALUE')).toContain('The gear may write DTR0');
    expect(text('DT8_SET_TEMPORARY_RGB')).toContain('Reads DTR0, DTR1, DTR2: set them first.');
    expect(text('DT8_ACTIVATE')).toContain('ENABLE DEVICE TYPE 8 goes first, added for you.');
    expect(text('DT8_ACTIVATE')).toContain('Example: activate 0     (C1 08, 01 E2)');
    expect(text('GO_TO_SCENE')).toContain('Example: go-to-scene 0 3     (01 13)');
    expect(text('PROGRAM_SHORT_ADDRESS')).toContain('Example: program-short-address 5     (B7 0B)');
    expect(text('INITIALISE')).toContain('Example: initialise all     (A5 00)');
  });

  it("takes the governor's line from the rule table", () => {
    for (const s of COMMANDS) {
      const rule = ruleFor(s.id, s.reply !== 'none');
      const g = governorText(s);
      expect(g.length, s.id).toBeGreaterThan(0);
      expect(g.includes('Refused always.'), s.id).toBe(rule === 'refuse');
      expect(g.includes('reset unlock'), s.id).toBe(rule === 'reset' || rule === 'commissioning');
      expect(g.includes('expert unlock'), s.id).toBe(rule === 'expert' || rule === 'expert-curve');
    }
    expect(governorText(spec('DAPC'))).toContain('clamped');
    expect(governorText(spec('DAPC'))).toContain('Unverified gear takes it too.');
    expect(governorText(spec('UP'))).toContain('Needs gear whose safety profile is verified.');
    expect(governorText(spec('SET_FADE_TIME'))).toBe(
      'Needs gear whose safety profile is verified.',
    );
    expect(governorText(spec('DTR0'))).toBe('Allowed.');
    expect(governorText(spec('IDENTIFY_DEVICE'))).toBe('Refused always.');
  });

  it('says so when the research notes do not describe a command', () => {
    expect(daliHelp(spec('PING')).join(' ')).toContain('general knowledge of the standard');
    expect(daliHelp(spec('DAPC')).join(' ')).not.toContain('general knowledge');
  });

  it('asks for the prefix when a name is shared by device types only', () => {
    expect(help('query-extended-version-number', 'other')).toEqual([
      'query-extended-version-number names commands for more than one device type. Try help dt6-query-extended-version-number or help dt8-query-extended-version-number.',
    ]);
  });

  it('lists every command by group in help dali', () => {
    const text = help('dali', 'other').join('\n');
    for (const s of COMMANDS) expect(text, s.id).toContain(nameOf(s.id));
    for (const t of Object.values(GROUP_TITLES)) expect(text).toContain(t);
    expect(text).toContain('Levels (15):');
    for (const l of help('dali', 'other')) {
      expect(l.length).toBeLessThanOrEqual(WIDTH);
      expect(l).toBe(l.trimEnd());
    }
  });
});

describe('help -k', () => {
  it('finds topics and DALI commands by a word in their name or text', () => {
    const scene = help({ find: 'scene' }, 'other');
    expect(scene.some((l) => l.startsWith('scene '))).toBe(true);
    expect(scene.some((l) => l.startsWith('go-to-scene: '))).toBe(true);
    expect(scene.some((l) => l.startsWith('query-scene-level: '))).toBe(true);
    expect(scene.at(-1)).toBe('help <name> says more about any of these.');
    expect(help({ find: 'MIREK' }, 'other').some((l) => l.startsWith('tc '))).toBe(true);
  });

  it('caps a long list and says how many more there are', () => {
    const all = help({ find: 'e' }, 'other');
    expect(all.length).toBe(32);
    expect(all.at(-2)).toMatch(/^\d+ more\. Try a longer word\.$/);
    for (const l of all) expect(l.length).toBeLessThanOrEqual(WIDTH);
  });

  it('says when nothing matches', () => {
    expect(help({ find: 'zebra' }, 'other')).toEqual(['Nothing in help mentions "zebra".']);
  });
});

describe('help topics', () => {
  it('shows both the console command and the DALI command for off', () => {
    const off = help('off', 'other');
    expect(off[0]).toBe('off <addr>');
    expect(off.join('\n')).toContain('OFF, IEC 62386-102');
  });

  it('has explain and hardware, and names both in the first screen', () => {
    expect(help('explain', 'other')[0]).toBe('explain <line>');
    expect(help('hardware', 'other').join(' ')).toContain('ADR 0022');
    const top = help(undefined, 'other').join('\n');
    expect(top).toContain('explain');
    expect(top).toContain('help -k <word>');
  });

  it('points an unknown topic at the word search', () => {
    expect(help('nope', 'mac')).toEqual([
      'No help for "nope". Type help for the list, or help -k nope to look it up.',
    ]);
  });
});
