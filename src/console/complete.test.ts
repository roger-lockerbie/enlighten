/** U-console: completion, reply texts and help. */
import { describe, expect, it } from 'vitest';
import { BINDINGS } from './keys.ts';
import { complete, type CompleteContext } from './complete.ts';
import { help, HELP_TOPICS } from './help.ts';
import { COLLISION, replyName, replyText } from './replies.ts';

const ctx: CompleteContext = {
  addresses: [0, 1],
  aliases: ['tw'],
  scripts: ['first-light', 'fade-test'],
};
const at = (b: string) => complete(b, b.length, ctx);

describe('complete', () => {
  it('completes a command name with a space', () => {
    expect(at('lev')).toEqual({ from: 0, to: 3, text: 'level ', items: [] });
    expect(at('level')).toEqual({ from: 0, to: 5, text: 'level ', items: [] });
    expect(complete('level 0', 5, ctx)).toBeUndefined();
    expect(at('recall-max')).toEqual({ from: 0, to: 10, text: 'recall-max-level ', items: [] });
  });

  it('extends to the common prefix and lists the candidates', () => {
    const r = at('query-a');
    expect(r?.text).toBe('query-a');
    expect(r?.items).toEqual(['query-actual-level', 'query-assigned-colour']);
    expect(at('set-max')?.text).toBe('set-max-level ');
    const s = at('sc');
    expect(s?.text).toBe('sc');
    expect(s?.items).toEqual(['scan', 'scene', 'scripts']);
    expect(at('query-ac')?.text).toBe('query-actual-level ');
    expect(at('tc')?.items).toEqual([]);
  });

  it('completes addresses, scene words and numbers, and script names', () => {
    expect(at('level ')?.items).toContain('tw');
    expect(at('level t')?.text).toBe('tw ');
    expect(at('scene 0 r')?.items).toEqual(['recall', 'remove']);
    expect(at('scene 0 recall 1')?.items).toEqual(['1', '10', '11', '12', '13', '14', '15']);
    expect(at('scene 0 list ')).toBeUndefined();
    expect(at('group 0 a')?.text).toBe('add ');
    expect(at('group 0 add 9')?.text).toBe('9 ');
    expect(at('run f')?.items).toEqual(['fade-test', 'first-light']);
    expect(at('run fi')?.text).toBe('first-light ');
    expect(at('go-to-scene 0 7')?.text).toBe('7 ');
    expect(at('go-to-scene t')?.text).toBe('tw ');
    expect(at('query 0 act')?.text).toBe('actual-level ');
    expect(at('query 0 lev')?.text).toBe('level ');
    expect(at('help ke')?.text).toBe('keys ');
    expect(at('unlock r')?.items).toEqual(['rate', 'reset']);
    expect(at('lock e')?.text).toBe('expert ');
    expect(at('target b')?.text).toBe('both ');
    expect(at('trace o')?.items).toEqual(['off', 'on']);
    expect(at('profile a')?.items).toEqual(['all', 'apply']);
    expect(at('dapc a')?.text).toBe('all ');
  });

  it('has nothing to complete on an empty line, after a value, in a comment or a quote', () => {
    expect(at('')).toBeUndefined();
    expect(at('   ')).toBeUndefined();
    expect(at('level 0 5')).toBeUndefined();
    expect(at('dtr0 ')).toBeUndefined();
    expect(at('run x y')).toBeUndefined();
    expect(at('# lev')).toBeUndefined();
    expect(at('echo "lev')).toBeUndefined();
    expect(at('zzz')).toBeUndefined();
    expect(at('help keys ')).toBeUndefined();
    expect(at('unlock rate ')).toBeUndefined();
    expect(at('target hw ')).toBeUndefined();
    expect(at('trace on ')).toBeUndefined();
    expect(at('scene 0 recall 3 ')).toBeUndefined();
    expect(at('group 0 add 1 ')).toBeUndefined();
    expect(at('query 0 level ')).toBeUndefined();
    expect(at('profile 0 ')).toBeUndefined();
    expect(at('go-to-scene 0 1 ')).toBeUndefined();
  });
});

describe('replies', () => {
  it('prints a level with its output and the raw byte', () => {
    expect(replyText('QUERY_ACTUAL_LEVEL', 170)).toBe('actual level 170 (10.1%) [0xAA]');
    expect(replyText('QUERY_ACTUAL_LEVEL', 0)).toBe('actual level 0 (off) [0x00]');
    expect(replyText('QUERY_SCENE_LEVEL', 255)).toBe(
      'scene level 255 (MASK: not in this scene) [0xFF]',
    );
    // 0 and 255 mean different things for different levels (S6-D5).
    expect(replyText('QUERY_POWER_ON_LEVEL', 255)).toBe(
      'power on level 255 (MASK: the last level before power was lost) [0xFF]',
    );
    expect(replyText('QUERY_POWER_ON_LEVEL', 0)).toBe(
      'power on level 0 (stays off at power-on) [0x00]',
    );
    expect(replyText('QUERY_SYSTEM_FAILURE_LEVEL', 255)).toBe(
      'system failure level 255 (MASK: no change) [0xFF]',
    );
    expect(replyText('QUERY_ACTUAL_LEVEL', 255)).toBe(
      'actual level 255 (MASK: starting up, or a lamp error) [0xFF]',
    );
    expect(replyText('QUERY_MAX_LEVEL', 0)).toBe('max level 0 (off) [0x00]');
    expect(replyText('QUERY_MAX_LEVEL', 255)).toBe('max level 255 (MASK) [0xFF]');
    expect(replyText('QUERY_ACTUAL_LEVEL', 'none')).toBe('actual level: no reply');
    expect(replyText('QUERY_ACTUAL_LEVEL', 'collision')).toBe(`actual level: ${COLLISION}`);
  });

  it('decodes yes and no, status, fades, groups, device types and colour features', () => {
    expect(replyText('QUERY_CONTROL_GEAR_PRESENT', 255)).toBe('control gear present: yes [0xFF]');
    expect(replyText('QUERY_CONTROL_GEAR_PRESENT', 'none')).toBe('control gear present: no');
    expect(replyText('QUERY_STATUS', 0b0000_0100)).toBe('status lamp on [0x04]');
    expect(replyText('QUERY_STATUS', 0)).toBe('status nothing set [0x00]');
    expect(replyText('QUERY_STATUS', 0xff)).toContain('power failure');
    expect(replyText('QUERY_FADE_TIME_FADE_RATE', 0x47)).toBe(
      'fade time/fade rate fade time 4 (2 s), fade rate 7 (44.7 steps/s) [0x47]',
    );
    expect(replyText('QUERY_FADE_TIME_FADE_RATE', 0x00)).toContain(
      'fade time 0 (none), fade rate 0 (none)',
    );
    expect(replyText('QUERY_EXTENDED_FADE_TIME', 0x21)).toContain('(2 s)');
    expect(replyText('QUERY_EXTENDED_FADE_TIME', 0)).toBe('extended fade time 0 (none) [0x00]');
    expect(replyText('QUERY_GROUPS_0_7', 0b101)).toBe('groups 0-7 g0 g2 [0x05]');
    expect(replyText('QUERY_GROUPS_8_15', 0b1)).toBe('groups 8-15 g8 [0x01]');
    expect(replyText('QUERY_GROUPS_8_15', 0)).toBe('groups 8-15 none [0x00]');
    expect(replyText('QUERY_DEVICE_TYPE', 8)).toBe('device type DT8 [0x08]');
    expect(replyText('QUERY_DEVICE_TYPE', 255)).toBe('device type several [0xFF]');
    expect(replyText('QUERY_NEXT_DEVICE_TYPE', 254)).toBe('next device type none left [0xFE]');
    expect(replyText('DT8_QUERY_COLOUR_TYPE_FEATURES', 0b0000_0010)).toBe(
      'colour type features Tc [0x02]',
    );
    expect(replyText('DT8_QUERY_COLOUR_TYPE_FEATURES', 0b1010_0101)).toBe(
      'colour type features xy, 1 primaries, 5 RGBWAF channels [0xA5]',
    );
    expect(replyText('DT8_QUERY_COLOUR_TYPE_FEATURES', 0)).toBe('colour type features none [0x00]');
    expect(replyText('QUERY_VERSION_NUMBER', 8)).toBe('version number 8 [0x08]');
    expect(replyName('DT8_QUERY_COLOUR_VALUE')).toBe('colour value');
  });
});

describe('help', () => {
  it('lists commands and explains each topic', () => {
    expect(help(undefined, 'mac')[0]).toContain('Commands:');
    for (const t of HELP_TOPICS) expect(help(t, 'mac').length).toBeGreaterThan(0);
    expect(help('level', 'mac')[0]).toBe('level <addr> <value> [fade <time>]');
    expect(help('recall-max-level', 'mac')).toEqual([
      'recall-max-level is a DALI command. See help dali.',
    ]);
    expect(help('nope', 'mac')).toEqual(['No help for "nope". Type help for the list.']);
  });

  it('prints the keys from the binding table, for the platform in use', () => {
    const mac = help('keys', 'mac');
    expect(mac).toHaveLength(BINDINGS.length);
    const other = help('keys', 'other');
    expect(other).toHaveLength(BINDINGS.length + 1);
    expect(other.find((l) => l.includes('Kill the word before'))).toContain('also Ctrl-W');
  });
});
