import { describe, expect, it } from 'vitest';
import { short } from '../dali/address.ts';
import { freeId, newAction, plateTarget, runNames, setAction, setFilter, setLed } from './edit.ts';
import { presetPlate } from './presets.ts';
import { parsePlates } from './schema.ts';
import type { ActionKind } from './plate.ts';

const KINDS: ActionKind[] = ['none', 'toggle', 'on', 'off', 'scene', 'dim', 'tune', 'run', 'stop'];

describe('plate edits', () => {
  it('every new action passes the schema once placed on a plate', () => {
    for (const k of KINDS) {
      const p = setAction(presetPlate('p1', 'zencontrol', 1), 0, 'double', newAction(k, short(3)));
      if (k === 'run') continue; // a run needs a name
      expect(parsePlates([JSON.parse(JSON.stringify(p))]).ok, k).toBe(true);
    }
  });

  it('clears a mapping with none or undefined', () => {
    const p = presetPlate('p1', 'zencontrol', 1);
    expect(setAction(p, 0, 'short', undefined).buttons[0]?.mapping.short).toBeUndefined();
    expect(setAction(p, 0, 'short', { kind: 'none' }).buttons[0]?.mapping.short).toBeUndefined();
  });

  it('finds the plate target, free ids and run names', () => {
    const p = presetPlate('p1', 'zencontrol', 2, short(7));
    expect(plateTarget(p)).toEqual(short(7));
    expect(freeId([p])).toBe('p2');
    const q = setAction(p, 1, 'double', { kind: 'run', what: 'effect', name: 'Breathe' });
    expect(runNames([q])).toEqual([{ what: 'effect', name: 'Breathe' }]);
    expect(setLed(q, 0, 'always').buttons[0]?.led).toBe('always');
    expect(setFilter(q, 3).filter).toBe(3);
  });
});
