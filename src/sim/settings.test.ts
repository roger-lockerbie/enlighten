import { describe, expect, it } from 'vitest';
import { extraUnit } from './simulator.ts';
import { DEFAULT_SETTINGS, SETTINGS_INFO, type Da5lSettings } from './profile.ts';
import {
  DEFAULT_SETUP,
  extraId,
  extraProfile,
  fitBench,
  parseExtras,
  parseSettings,
  parseUnitSetup,
  SETTING_EDIT,
  settingAllowed,
} from './settings.ts';

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

  it('refuses a factory MAX LEVEL below the physical minimum', () => {
    expect(parseSettings({ physicalMinimum: 100, factoryMaxLevel: 90 })).toBe(
      'The factory MAX LEVEL is below the physical minimum.',
    );
    expect(parseSettings({ factoryMaxLevel: 50 })).toMatch(/below the physical minimum/);
    expect(parseSettings({ physicalMinimum: 50, factoryMaxLevel: 50 })).toEqual({
      physicalMinimum: 50,
      factoryMaxLevel: 50,
    });
  });

  it('starts a unit whose physical minimum is above the ceiling with its default set-up', () => {
    const high = { presentation: 'rgbwaf' as const, settings: { physicalMinimum: 200 } };
    expect(fitBench({ A: high }, 150)).toEqual(DEFAULT_SETUP);
    expect(fitBench({ A: high }, 220).A).toEqual(high);
    expect(fitBench({}, 220)).toEqual(DEFAULT_SETUP);
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

describe('extra simulated drivers (R14.2)', () => {
  it('accepts up to four at addresses the bench does not use, in address order', () => {
    expect(
      parseExtras([
        { address: 63, lightType: 'C5' },
        { address: 2, lightType: 'C2' },
      ]),
    ).toEqual([
      { address: 2, lightType: 'C2' },
      { address: 63, lightType: 'C5' },
    ]);
    expect(parseExtras([])).toEqual([]);
  });

  it('gives a reason for anything else', () => {
    expect(parseExtras({})).toBe('Extra drivers are a list.');
    expect(parseExtras([1])).toBe('An extra driver is an object.');
    expect(parseExtras([null])).toBe('An extra driver is an object.');
    expect(parseExtras([{ address: 2, lightType: 'C2', x: 1 }])).toBe('Unknown key x.');
    for (const address of [0, 1, 64, 2.5, '3'])
      expect(parseExtras([{ address, lightType: 'C2' }])).toBe(
        "An extra driver's address is from 2 to 63.",
      );
    expect(parseExtras([{ address: 2, lightType: 'C3' }])).toBe('An extra driver is a C2 or a C5.');
    expect(
      parseExtras([
        { address: 2, lightType: 'C2' },
        { address: 2, lightType: 'C5' },
      ]),
    ).toBe('Two drivers cannot share address 2.');
    expect(parseExtras([2, 3, 4, 5, 6].map((address) => ({ address, lightType: 'C2' })))).toBe(
      'At most 4 simulated drivers can be added.',
    );
  });

  it('builds each as a DA5-L that presents as the bench units do', () => {
    expect(extraProfile({ address: 2, lightType: 'C2' }).presentation).toBe('tc');
    expect(extraProfile({ address: 2, lightType: 'C5' }).presentation).toBe('rgbwaf');
    const u = extraUnit({ address: 9, lightType: 'C5' }, 50);
    expect(u.id).toBe(extraId(9));
    expect(u.gear.shortAddress).toBe(9);
  });
});
