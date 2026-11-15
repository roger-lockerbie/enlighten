import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_INFO, type Da5lSettings } from './profile.ts';
import { parseSettings, parseUnitSetup, SETTING_EDIT, settingAllowed } from './settings.ts';

const keys = Object.keys(DEFAULT_SETTINGS) as (keyof Da5lSettings)[];

describe('the editable simulator settings', () => {
  it('cover every setting the research lists, and every default is allowed or fixed', () => {
    expect(Object.keys(SETTING_EDIT).sort()).toEqual([...keys].sort());
    expect(SETTINGS_INFO.map((s) => s.key).sort()).toEqual([...keys].sort());
    for (const k of keys) {
      const e = SETTING_EDIT[k];
      if (e.kind === 'fixed') continue;
      expect(settingAllowed(k, DEFAULT_SETTINGS[k]), k).toBe(true);
      if (e.kind === 'choice') expect(e.values[0], k).toBe(DEFAULT_SETTINGS[k]);
    }
  });

  it('refuses unknown keys, fixed settings, values outside a choice or range, and odd keys', () => {
    expect(settingAllowed('nope', true)).toBe(false);
    expect(settingAllowed('__proto__', true)).toBe(false);
    expect(settingAllowed('toString', true)).toBe(false);
    expect(settingAllowed('tcLimits', DEFAULT_SETTINGS.tcLimits)).toBe(false);
    expect(settingAllowed('maxLowerPullsDown', 'yes')).toBe(false);
    expect(settingAllowed('physicalMinimum', 0)).toBe(false);
    expect(settingAllowed('physicalMinimum', 1.5)).toBe(false);
    expect(settingAllowed('physicalMinimum', 1)).toBe(true);
    expect(settingAllowed('fastFade27Ms', 700)).toBe(true);
    expect(settingAllowed('fastFade27Ms', 701)).toBe(false);
  });

  it('keeps only the values that differ from the defaults, in a fresh object', () => {
    const input = { maxLowerPullsDown: false, physicalMinimum: 85 };
    const out = parseSettings(input);
    expect(out).toEqual({ maxLowerPullsDown: false });
    expect(out).not.toBe(input);
  });

  it('refuses what is not a plain object, and names a bad key', () => {
    expect(parseSettings(null)).toBe('Settings are an object.');
    expect(parseSettings([])).toBe('Settings are an object.');
    expect(parseSettings({ x: 1 })).toBe('The setting x has no such value.');
    expect(parseSettings(JSON.parse('{"__proto__": {"a": 1}}'))).toMatch(/no such value/);
  });

  it('checks a unit set-up', () => {
    expect(parseUnitSetup({ presentation: 'rgbwaf' })).toEqual({
      presentation: 'rgbwaf',
      settings: {},
    });
    expect(parseUnitSetup({ presentation: 'tc', settings: { autoActivation: false } })).toEqual({
      presentation: 'tc',
      settings: { autoActivation: false },
    });
    expect(parseUnitSetup('x')).toMatch(/object/);
    expect(parseUnitSetup({ presentation: 'xy' })).toMatch(/tc or rgbwaf/);
    expect(parseUnitSetup({ presentation: 'tc', extra: 1 })).toMatch(/Unknown key/);
    expect(parseUnitSetup({ presentation: 'tc', settings: { reset: 'x' } })).toMatch(/no such/);
  });
});
