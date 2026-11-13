/**
 * U-sim: one block per section of `docs/research/dali.md`, and each profile setting in both positions.
 */
import { describe, expect, it } from 'vitest';
import { broadcast, group, short, unaddressed } from '../dali/address.ts';
import { arcToFraction } from '../dali/curve.ts';
import { fadeTimeMs } from '../dali/fade.ts';
import { decodeStatus } from '../dali/reply.ts';
import { rgbwafCommands, tcCommands } from '../dali/sequences.ts';
import { BUS_FAILURE_MS, Da5l, IDENTIFY_MS, POWER_UP_MS, RESET_DEAF_MS } from './gear.ts';
import {
  da5l,
  DEFAULT_SETTINGS,
  SETTINGS_INFO,
  type Da5lSettings,
  type LightType,
} from './profile.ts';
import { Rig } from './rig.ts';
import { Simulator } from './simulator.ts';

function rig(
  settings: Partial<Da5lSettings> = {},
  light: LightType = 'C2',
  presentation: 'tc' | 'rgbwaf' = 'tc',
) {
  const sim = Simulator.of([
    { id: 'A', profile: da5l(light, presentation, settings), opts: { shortAddress: 0 } },
  ]);
  return new Rig(sim);
}

function twoGear() {
  return new Rig(Simulator.bench());
}

const gearOf = (r: Rig, id = 'A'): Da5l => {
  const u = r.sim.unit(id);
  if (u === undefined) throw new Error('no unit');
  return u.gear;
};

const level = (r: Rig) => r.ask('QUERY_ACTUAL_LEVEL', 0);

describe('profile', () => {
  it('documents every setting with a source and a hardware-day check', () => {
    const keys = Object.keys(DEFAULT_SETTINGS).sort();
    expect(SETTINGS_INFO.map((s) => s.key).sort()).toEqual(keys);
    for (const s of SETTINGS_INFO) {
      expect(s.source.length).toBeGreaterThan(5);
      expect(s.hardwareDay.length).toBeGreaterThan(5);
    }
  });
  it('builds the bench as SPEC R14.1 says', () => {
    const r = twoGear();
    expect(r.ask('QUERY_CONTROL_GEAR_PRESENT', 0)).toBe(255);
    expect(r.ask('QUERY_CONTROL_GEAR_PRESENT', 1)).toBe(255);
    expect(r.ask('QUERY_CONTROL_GEAR_PRESENT', 2)).toBe('none');
    expect(gearOf(r, 'A').profile.lightType).toBe('C2');
    expect(gearOf(r, 'B').profile.lightType).toBe('C5');
  });
  it('fixes the presentation for light types that have only one', () => {
    expect(da5l('C3', 'tc').presentation).toBe('rgbwaf');
    expect(da5l('C1').presentation).toBe('rgbwaf');
  });
});

describe('1. frames and addresses', () => {
  it('answers by short address, group, broadcast and unaddressed broadcast', () => {
    const r = twoGear();
    r.to('ADD_TO_GROUP', 1, 3);
    expect(r.ask('QUERY_CONTROL_GEAR_PRESENT', group(3))).toBe(255);
    expect(r.ask('QUERY_CONTROL_GEAR_PRESENT', broadcast)).toBe('collision');
    expect(r.ask('QUERY_CONTROL_GEAR_PRESENT', unaddressed)).toBe('none');
  });
  it('a frame that does not decode does nothing', () => {
    const r = rig();
    expect(
      r.frames([{ frame: { a: 0x01, b: 230 }, sendTwice: false, expectReply: true }]).kind,
    ).toBe('none');
  });
});

describe('2. arc levels and the curve', () => {
  it('drives the output on the log curve', () => {
    const r = rig({ physicalMinimum: 1 }, 'C1');
    r.to('DAPC', 0, 220);
    const out = gearOf(r).outputAt(r.t);
    expect(out.terminals[0]).toBeCloseTo(arcToFraction(220), 9);
    expect(out.labels).toEqual(['mono', 'mono', 'mono', 'mono', 'mono']);
  });
  it('quantises PWM when the profile says so', () => {
    const r = rig({ physicalMinimum: 1, pwmSteps: 100 }, 'C1');
    r.to('DAPC', 0, 100);
    const d = gearOf(r).outputAt(r.t).terminals[0] ?? -1;
    expect(Math.round(d * 100)).toBeCloseTo(d * 100, 9);
  });
});

describe('3. level limits', () => {
  it('clamps DAPC to MIN and MAX and sets the limit error', () => {
    const r = rig();
    r.set('SET_MAX_LEVEL', 0, 200);
    r.to('DAPC', 0, 254);
    expect(level(r)).toBe(200);
    expect(r.ask('QUERY_LIMIT_ERROR', 0)).toBe(255);
    r.to('DAPC', 0, 10);
    expect(level(r)).toBe(85);
    r.to('DAPC', 0, 150);
    expect(r.ask('QUERY_LIMIT_ERROR', 0)).toBe('none');
  });
  it('stores SET MAX LEVEL and SET MIN LEVEL by the rules', () => {
    const r = rig();
    r.set('SET_MAX_LEVEL', 0, 255);
    expect(r.ask('QUERY_MAX_LEVEL', 0)).toBe(254);
    r.set('SET_MAX_LEVEL', 0, 50);
    expect(r.ask('QUERY_MAX_LEVEL', 0)).toBe(85);
    r.set('SET_MAX_LEVEL', 0, 200);
    r.set('SET_MIN_LEVEL', 0, 250);
    expect(r.ask('QUERY_MIN_LEVEL', 0)).toBe(200);
    r.set('SET_MIN_LEVEL', 0, 255);
    expect(r.ask('QUERY_MIN_LEVEL', 0)).toBe(200);
    r.set('SET_MIN_LEVEL', 0, 1);
    expect(r.ask('QUERY_MIN_LEVEL', 0)).toBe(85);
    expect(r.ask('QUERY_PHYSICAL_MINIMUM', 0)).toBe(85);
  });
  for (const pulls of [true, false]) {
    it(`lowering MAX LEVEL ${pulls ? 'pulls' : 'does not pull'} the level down`, () => {
      const r = rig({ maxLowerPullsDown: pulls });
      r.to('DAPC', 0, 200);
      r.set('SET_MAX_LEVEL', 0, 150);
      expect(level(r)).toBe(pulls ? 150 : 200);
    });
    it(`raising MIN LEVEL ${pulls ? 'lifts' : 'does not lift'} the level`, () => {
      const r = rig({ minRaiseLifts: pulls });
      r.to('DAPC', 0, 100);
      r.set('SET_MIN_LEVEL', 0, 150);
      expect(level(r)).toBe(pulls ? 150 : 100);
    });
  }
  it('lowering MAX LEVEL during a fade upward holds the fade under it', () => {
    const r = rig();
    r.set('SET_FADE_TIME', 0, 7);
    r.to('DAPC', 0, 254);
    r.wait(1000);
    r.set('SET_MAX_LEVEL', 0, 150);
    r.wait(10_000);
    expect(level(r)).toBeLessThanOrEqual(150);
  });
  it('raising MIN LEVEL does not switch the gear on', () => {
    const r = rig();
    r.set('SET_MIN_LEVEL', 0, 150);
    expect(level(r)).toBe(0);
  });
});

describe('4. power-on and system failure', () => {
  for (const out of ['off', 'max'] as const) {
    it(`power-up: ${out} for 0.6 s, then POWER ON LEVEL`, () => {
      const r = rig({ powerUpOutput: out });
      r.set('SET_POWER_ON_LEVEL', 0, 150);
      const g = gearOf(r);
      g.powerDown(r.t);
      r.wait(1000);
      g.powerUp(r.t);
      expect(g.levelAt(r.t + 10)).toBe(out === 'off' ? 0 : 254);
      r.wait(POWER_UP_MS + 1);
      expect(level(r)).toBe(150);
      expect(r.ask('QUERY_POWER_FAILURE', 0)).toBe(255);
      r.to('DAPC', 0, 100);
      expect(r.ask('QUERY_POWER_FAILURE', 0)).toBe('none');
    });
  }
  it('power-up with POWER ON LEVEL 0 stays off, and 255 restores the last level', () => {
    const r = rig();
    r.set('SET_POWER_ON_LEVEL', 0, 0);
    const g = gearOf(r);
    r.to('DAPC', 0, 180);
    g.powerDown(r.t);
    g.powerUp(r.t + 100);
    r.wait(2000);
    expect(level(r)).toBe(0);
    r.set('SET_POWER_ON_LEVEL', 0, 255);
    r.to('DAPC', 0, 180);
    g.powerDown(r.t);
    g.powerUp(r.t + 100);
    r.wait(2000);
    expect(level(r)).toBe(180);
  });
  it('a command in the first 0.6 s wins over POWER ON LEVEL', () => {
    const r = rig();
    const g = gearOf(r);
    g.powerDown(r.t);
    g.powerUp(r.t);
    r.to('DAPC', 0, 120);
    r.wait(2000);
    expect(level(r)).toBe(120);
  });
  for (const mode of ['step', 'fade'] as const) {
    it(`bus failure: ${mode} to SYSTEM FAILURE LEVEL after 0.5 s`, () => {
      const r = rig({ systemFailure: mode });
      r.set('SET_FADE_TIME', 0, 4);
      r.set('SET_SYSTEM_FAILURE_LEVEL', 0, 100);
      r.to('DAPC', 0, 200);
      r.wait(3000);
      const g = gearOf(r);
      const t = r.t;
      g.busDown(t);
      expect(g.levelAt(t + BUS_FAILURE_MS - 1)).toBeCloseTo(200, 6);
      const mid = g.levelAt(t + BUS_FAILURE_MS + 1000);
      if (mode === 'step') expect(mid).toBe(100);
      else expect(mid).toBeGreaterThan(100);
      expect(g.levelAt(t + BUS_FAILURE_MS + 5000)).toBe(100);
      expect(r.ask('QUERY_ACTUAL_LEVEL', 0)).toBe('none');
    });
  }
  it('SYSTEM FAILURE LEVEL 255 keeps the level, and a short dropout does nothing', () => {
    const r = rig();
    r.to('DAPC', 0, 200);
    const g = gearOf(r);
    g.busDown(r.t);
    g.busUp(r.t + 200);
    r.wait(2000);
    expect(level(r)).toBe(200);
    r.set('SET_SYSTEM_FAILURE_LEVEL', 0, 255);
    g.busDown(r.t);
    r.wait(2000);
    g.busUp(r.t);
    expect(level(r)).toBe(200);
  });
  for (const ret of ['stays', 'power-on-level'] as const) {
    it(`when the bus returns, the level ${ret === 'stays' ? 'stays' : 'goes to POWER ON LEVEL'}`, () => {
      const r = rig({ busReturn: ret });
      r.set('SET_SYSTEM_FAILURE_LEVEL', 0, 100);
      r.set('SET_POWER_ON_LEVEL', 0, 0);
      r.to('DAPC', 0, 200);
      const g = gearOf(r);
      g.busDown(r.t);
      r.wait(1000);
      g.busUp(r.t);
      expect(level(r)).toBe(ret === 'stays' ? 100 : 0);
    });
  }
});

describe('5. RESET', () => {
  it('restores the reset values, goes to full, and is deaf for 300 ms', () => {
    const r = rig();
    r.set('SET_MAX_LEVEL', 0, 150);
    r.set('SET_POWER_ON_LEVEL', 0, 0);
    r.set('SET_FADE_TIME', 0, 5);
    r.set('SET_SCENE', 0, 120, 3);
    r.to('ADD_TO_GROUP', 0, 2);
    r.dtr(0, 77);
    r.to('RESET', 0);
    const g = gearOf(r);
    expect(g.levelAt(r.t)).toBe(254);
    expect(r.ask('QUERY_MAX_LEVEL', 0)).toBe('none');
    r.wait(RESET_DEAF_MS);
    expect(r.ask('QUERY_MAX_LEVEL', 0)).toBe(254);
    expect(r.ask('QUERY_POWER_ON_LEVEL', 0)).toBe(254);
    expect(r.ask('QUERY_SYSTEM_FAILURE_LEVEL', 0)).toBe(254);
    expect(r.ask('QUERY_FADE_TIME_FADE_RATE', 0)).toBe(0x07);
    expect(r.ask('QUERY_SCENE_LEVEL', 0, 3)).toBe(255);
    expect(r.ask('QUERY_GROUPS_0_7', 0)).toBe(0);
    expect(r.ask('QUERY_CONTENT_DTR0', 0)).toBe(77);
    expect(r.ask('QUERY_RESET_STATE', 0)).toBe(255);
    expect(decodeStatus(Number(r.ask('QUERY_STATUS', 0))).resetState).toBe(true);
  });
  it('fades to full when the profile says so', () => {
    const r = rig({ reset: 'fade' });
    r.set('SET_FADE_TIME', 0, 4);
    r.to('DAPC', 0, 100);
    r.wait(3000);
    r.to('RESET', 0);
    const g = gearOf(r);
    expect(g.levelAt(r.t + 500)).toBeLessThan(254);
    expect(g.levelAt(r.t + 3000)).toBe(254);
  });
});

describe('6. DTRs and send twice', () => {
  it('sets and reads the three registers, and STORE ACTUAL LEVEL IN DTR0 writes one', () => {
    const r = rig();
    r.dtr(0, 1);
    r.dtr(1, 2);
    r.dtr(2, 3);
    expect([
      r.ask('QUERY_CONTENT_DTR0', 0),
      r.ask('QUERY_CONTENT_DTR1', 0),
      r.ask('QUERY_CONTENT_DTR2', 0),
    ]).toEqual([1, 2, 3]);
    r.to('DAPC', 0, 140);
    r.to('STORE_ACTUAL_LEVEL_IN_DTR0', 0);
    expect(r.ask('QUERY_CONTENT_DTR0', 0)).toBe(140);
  });
  it('a configuration command sent once does nothing', () => {
    const r = rig();
    r.dtr(0, 100);
    r.frames([{ frame: { a: 0x01, b: 42 }, sendTwice: false, expectReply: false }]);
    expect(r.ask('QUERY_MAX_LEVEL', 0)).toBe(254);
  });
  it('the second copy must come within 100 ms', () => {
    const r = rig();
    r.dtr(0, 100);
    const f = { frame: { a: 0x01, b: 42 }, sendTwice: false, expectReply: false };
    r.sim.send(f, r.t + 10);
    r.sim.send(f, r.t + 150);
    r.t += 200;
    expect(r.ask('QUERY_MAX_LEVEL', 0)).toBe(254);
  });
  for (const cancels of [true, false]) {
    it(`a frame to another address between the copies ${cancels ? 'cancels' : 'does not cancel'} the pair`, () => {
      const sim = Simulator.of([
        {
          id: 'A',
          profile: da5l('C2', 'tc', { sendTwiceCancelledByOtherFrame: cancels }),
          opts: { shortAddress: 0 },
        },
        {
          id: 'B',
          profile: da5l('C5', 'rgbwaf', { sendTwiceCancelledByOtherFrame: cancels }),
          opts: { shortAddress: 1 },
        },
      ]);
      const r = new Rig(sim);
      r.dtr(0, 100);
      const f = { frame: { a: 0x01, b: 42 }, sendTwice: false, expectReply: false };
      sim.send(f, r.t + 10);
      sim.send({ frame: { a: 0x02, b: 200 }, sendTwice: false, expectReply: false }, r.t + 40);
      sim.send(f, r.t + 70);
      r.t += 100;
      expect(r.ask('QUERY_MAX_LEVEL', 0)).toBe(cancels ? 254 : 100);
    });
  }
  for (const form of ['both', 'once', 'before-each'] as const) {
    it(`ENABLE DEVICE TYPE form setting "${form}"`, () => {
      const r = rig({ enableDeviceTypeForm: form });
      const edt = { frame: { a: 0xc1, b: 8 }, sendTwice: false, expectReply: false };
      const store = { frame: { a: 0x01, b: 243 }, sendTwice: false, expectReply: false };
      r.dtr(0, 0);
      // Once: EDT, command, command (as the hasseb sends it).
      r.sim.send(edt, r.t + 10);
      r.sim.send(store, r.t + 40);
      r.sim.send(store, r.t + 70);
      r.t += 100;
      const afterOnce = r.ask('DT8_QUERY_GEAR_FEATURES', 0);
      r.dtr(0, 1);
      // Before each: EDT, command, EDT, command.
      r.sim.send(edt, r.t + 10);
      r.sim.send(store, r.t + 30);
      r.sim.send(edt, r.t + 50);
      r.sim.send(store, r.t + 70);
      r.t += 100;
      const afterEach = r.ask('DT8_QUERY_GEAR_FEATURES', 0);
      expect(afterOnce).toBe(form === 'before-each' ? 1 : 0);
      expect(afterEach).toBe(form === 'once' ? 0 : 1);
      const seen = gearOf(r).snapshot().enableDeviceTypeFormsSeen;
      expect(seen.once + seen.beforeEach).toBeGreaterThanOrEqual(1);
    });
  }
});

describe('7. fades', () => {
  it('fades over the fade time', () => {
    const r = rig();
    r.set('SET_FADE_TIME', 0, 4);
    r.to('DAPC', 0, 200);
    const g = gearOf(r);
    r.wait(fadeTimeMs(4) + 10);
    expect(level(r)).toBe(200);
    r.to('DAPC', 0, 100);
    const start = r.t;
    expect(g.levelAt(start + 1000)).toBeCloseTo(150, 0);
    expect(decodeStatus(Number(r.ask('QUERY_STATUS', 0))).fadeRunning).toBe(true);
    expect(g.fadeRunning(start + 2100)).toBe(false);
  });
  it('uses the extended fade time when the fade time is 0, and the fast fade time before it', () => {
    const r = rig({ minFastFadeCount: 4 });
    r.set('SET_EXTENDED_FADE_TIME', 0, 0x33);
    r.to('DAPC', 0, 200);
    const g = gearOf(r);
    expect(g.fadeMs()).toBe(40_000);
    expect(r.ask('QUERY_EXTENDED_FADE_TIME', 0)).toBe(0x33);
    r.set('DT6_STORE_DTR_AS_FAST_FADE_TIME', 0, 8);
    expect(g.fadeMs()).toBe(200);
    expect(r.ask('DT6_QUERY_FAST_FADE_TIME', 0)).toBe(8);
    expect(r.ask('DT6_QUERY_MIN_FAST_FADE_TIME', 0)).toBe(4);
    r.set('DT6_STORE_DTR_AS_FAST_FADE_TIME', 0, 2);
    expect(r.ask('DT6_QUERY_FAST_FADE_TIME', 0)).toBe(4);
    r.set('SET_EXTENDED_FADE_TIME', 0, 0x50);
    expect(r.ask('QUERY_EXTENDED_FADE_TIME', 0)).toBe(0);
  });
  it('stores no fast fade time when the gear has none', () => {
    const r = rig();
    r.set('DT6_STORE_DTR_AS_FAST_FADE_TIME', 0, 8);
    expect(r.ask('DT6_QUERY_FAST_FADE_TIME', 0)).toBe(0);
  });
  it('clamps the fade time and rate', () => {
    const r = rig();
    r.set('SET_FADE_TIME', 0, 40);
    r.set('SET_FADE_RATE', 0, 0);
    expect(r.ask('QUERY_FADE_TIME_FADE_RATE', 0)).toBe(0xf1);
  });
  for (const mode of ['jump-to-min', 'from-zero'] as const) {
    it(`fade from off: ${mode}`, () => {
      const r = rig({ fadeFromOff: mode });
      r.set('SET_FADE_TIME', 0, 8);
      r.to('DAPC', 0, 254);
      const g = gearOf(r);
      const early = g.levelAt(r.t + 1);
      if (mode === 'jump-to-min') expect(early).toBeGreaterThanOrEqual(85);
      else expect(early).toBeLessThan(10);
    });
  }
  for (const mode of ['from-present', 'from-target'] as const) {
    it(`a new command mid-fade starts ${mode}`, () => {
      const r = rig({ commandDuringFade: mode });
      r.set('SET_FADE_TIME', 0, 4);
      r.to('DAPC', 0, 100);
      r.wait(3000);
      r.to('DAPC', 0, 200);
      r.wait(900);
      r.to('DAPC', 0, 100);
      const g = gearOf(r);
      const v = g.levelAt(r.t + 1);
      if (mode === 'from-present') expect(v).toBeLessThan(195);
      else expect(v).toBeGreaterThan(199);
    });
  }
  it('DAPC 255 stops a fade where it is', () => {
    const r = rig();
    r.set('SET_FADE_TIME', 0, 4);
    r.to('DAPC', 0, 100);
    r.wait(3000);
    r.to('DAPC', 0, 200);
    r.wait(1000);
    r.to('DAPC', 0, 255);
    const held = level(r);
    r.wait(3000);
    expect(level(r)).toBe(held);
    expect(held).toBeGreaterThan(100);
    expect(held).toBeLessThan(200);
  });
  for (const mode of ['present', 'target'] as const) {
    it(`QUERY ACTUAL LEVEL during a fade reports the ${mode}`, () => {
      const r = rig({ queryDuringFade: mode });
      r.set('SET_FADE_TIME', 0, 6);
      r.to('DAPC', 0, 100);
      r.wait(5000);
      r.to('DAPC', 0, 200);
      r.wait(1000);
      const v = level(r);
      if (mode === 'present') expect(v).toBeLessThan(200);
      else expect(v).toBe(200);
    });
  }
  for (const mode of ['fade-to-min-then-off', 'immediate'] as const) {
    it(`DAPC 0 with a fade time: ${mode}`, () => {
      const r = rig({ dapcZeroWithFade: mode });
      r.set('SET_FADE_TIME', 0, 4);
      r.to('DAPC', 0, 200);
      r.wait(3000);
      r.to('DAPC', 0, 0);
      const g = gearOf(r);
      const mid = g.levelAt(r.t + 1000);
      if (mode === 'immediate') expect(mid).toBe(0);
      else expect(mid).toBeGreaterThan(85);
      expect(g.levelAt(r.t + 2100)).toBe(0);
    });
  }
  it('OFF is always immediate', () => {
    const r = rig();
    r.set('SET_FADE_TIME', 0, 10);
    r.to('DAPC', 0, 200);
    r.wait(20_000);
    r.to('OFF', 0);
    expect(gearOf(r).levelAt(r.t)).toBe(0);
  });
  it('ENABLE DAPC SEQUENCE: DAPCs within 200 ms fade over 200 ms, and an indirect command ends it', () => {
    const r = rig();
    r.set('SET_FADE_TIME', 0, 10);
    r.to('DAPC', 0, 100);
    r.wait(20_000);
    r.to('ENABLE_DAPC_SEQUENCE', 0);
    r.to('DAPC', 0, 150);
    const g = gearOf(r);
    expect(g.levelAt(r.t + 200)).toBe(150);
    r.wait(150);
    r.to('DAPC', 0, 160);
    expect(g.levelAt(r.t + 200)).toBe(160);
    r.wait(300);
    r.to('STEP_UP', 0);
    r.to('DAPC', 0, 100);
    expect(g.levelAt(r.t + 200)).toBeGreaterThan(160);
  });
  for (const mode of ['accumulate', 'round-each'] as const) {
    it(`UP at fade rate 15 with ${mode} rounding`, () => {
      const r = rig({ upDownRounding: mode });
      r.set('SET_FADE_RATE', 0, 15);
      r.to('DAPC', 0, 100);
      for (let i = 0; i < 20; i++) {
        r.to('UP', 0);
        r.wait(250);
      }
      const v = level(r);
      if (mode === 'accumulate') expect(v).toBe(111);
      else expect(v).toBe(120);
    });
  }
  it('UP and DOWN run for 200 ms, stop at the limits and do not switch on or off', () => {
    const r = rig();
    r.to('UP', 0);
    expect(level(r)).toBe(0);
    r.to('DAPC', 0, 250);
    r.to('UP', 0);
    r.wait(300);
    expect(level(r)).toBe(254);
    r.to('DAPC', 0, 87);
    r.to('DOWN', 0);
    r.wait(300);
    expect(level(r)).toBe(85);
  });
  it('CONTINUOUS UP and DOWN fade to the limit at the fade rate', () => {
    const r = rig();
    r.set('SET_FADE_RATE', 0, 7);
    r.to('DAPC', 0, 100);
    r.to('CONTINUOUS_UP', 0);
    const g = gearOf(r);
    expect(g.levelAt(r.t + 1000)).toBeCloseTo(144.7, 0);
    r.wait(5000);
    expect(level(r)).toBe(254);
    r.to('CONTINUOUS_DOWN', 0);
    r.wait(5000);
    expect(level(r)).toBe(85);
    r.to('OFF', 0);
    r.to('CONTINUOUS_UP', 0);
    expect(level(r)).toBe(0);
  });
});

describe('8. level commands', () => {
  it('STEP UP, STEP DOWN, STEP DOWN AND OFF, ON AND STEP UP', () => {
    const r = rig();
    r.to('STEP_UP', 0);
    expect(level(r)).toBe(0);
    r.to('ON_AND_STEP_UP', 0);
    expect(level(r)).toBe(85);
    r.to('ON_AND_STEP_UP', 0);
    expect(level(r)).toBe(86);
    r.to('STEP_UP', 0);
    expect(level(r)).toBe(87);
    r.to('STEP_DOWN', 0);
    r.to('STEP_DOWN', 0);
    r.to('STEP_DOWN', 0);
    expect(level(r)).toBe(85);
    r.to('STEP_DOWN_AND_OFF', 0);
    expect(level(r)).toBe(0);
    r.to('STEP_DOWN', 0);
    r.to('STEP_DOWN_AND_OFF', 0);
    expect(level(r)).toBe(0);
    r.to('DAPC', 0, 120);
    r.to('STEP_DOWN_AND_OFF', 0);
    expect(level(r)).toBe(119);
  });
  it('RECALL MAX LEVEL and RECALL MIN LEVEL switch on at once', () => {
    const r = rig();
    r.set('SET_FADE_TIME', 0, 10);
    r.set('SET_MAX_LEVEL', 0, 220);
    r.to('RECALL_MAX_LEVEL', 0);
    expect(gearOf(r).levelAt(r.t)).toBe(220);
    r.to('RECALL_MIN_LEVEL', 0);
    expect(gearOf(r).levelAt(r.t)).toBe(85);
  });
  for (const mode of ['no-change', 'go'] as const) {
    it(`GO TO LAST ACTIVE LEVEL from off, and when on (${mode})`, () => {
      const r = rig({ goToLastActiveWhenOn: mode });
      r.to('DAPC', 0, 180);
      r.to('OFF', 0);
      r.to('GO_TO_LAST_ACTIVE_LEVEL', 0);
      expect(level(r)).toBe(180);
      // Stop a fade part way: the last active level is the fade's target.
      r.set('SET_FADE_TIME', 0, 4);
      r.to('DAPC', 0, 100);
      r.wait(3000);
      r.to('DAPC', 0, 200);
      r.wait(1000);
      r.to('DAPC', 0, 255);
      const held = level(r);
      r.to('GO_TO_LAST_ACTIVE_LEVEL', 0);
      r.wait(3000);
      expect(level(r)).toBe(mode === 'no-change' ? held : 200);
    });
  }
  it('GO TO LAST ACTIVE LEVEL straight after power-up gives MAX LEVEL', () => {
    const r = rig();
    r.set('SET_MAX_LEVEL', 0, 200);
    r.to('DAPC', 0, 100);
    const g = gearOf(r);
    g.powerDown(r.t);
    g.powerUp(r.t + 10);
    r.to('GO_TO_LAST_ACTIVE_LEVEL', 0);
    expect(level(r)).toBe(200);
  });
  for (const mode of ['flash-min-max', 'none'] as const) {
    it(`IDENTIFY DEVICE: ${mode}, stopped by another command`, () => {
      const r = rig({ identify: mode });
      r.to('DAPC', 0, 150);
      r.to('IDENTIFY_DEVICE', 0);
      const g = gearOf(r);
      const seen = new Set<number>();
      for (let t = r.t; t < r.t + 2000; t += 100) seen.add(g.levelAt(t));
      if (mode === 'flash-min-max') expect([...seen].sort()).toEqual([254, 85]);
      else expect([...seen]).toEqual([150]);
      if (mode === 'flash-min-max') {
        expect(g.breakpoints(r.t, r.t + 1100).length).toBeGreaterThan(2);
        r.to('QUERY_STATUS', 0);
        expect(g.levelAt(r.t + 600)).toBe(g.levelAt(r.t + 100));
      }
      expect(g.settlesAt()).toBeLessThanOrEqual(r.t + IDENTIFY_MS);
    });
  }
});

describe('9. scenes and groups', () => {
  it('stores, recalls with clamping, and treats 255 as not in the scene', () => {
    const r = rig();
    r.set('SET_SCENE', 0, 200, 4);
    r.set('SET_MAX_LEVEL', 0, 150);
    r.to('GO_TO_SCENE', 0, 4);
    expect(level(r)).toBe(150);
    r.to('REMOVE_FROM_SCENE', 0, 4);
    r.to('DAPC', 0, 100);
    r.to('GO_TO_SCENE', 0, 4);
    expect(level(r)).toBe(100);
    r.set('SET_SCENE', 0, 0, 5);
    r.to('GO_TO_SCENE', 0, 5);
    expect(level(r)).toBe(0);
    expect(r.ask('QUERY_SCENE_LEVEL', 0, 5)).toBe(0);
  });
  it('a scene of 0 fades to MIN then off when the profile says so', () => {
    const r = rig();
    r.set('SET_FADE_TIME', 0, 4);
    r.to('DAPC', 0, 200);
    r.wait(3000);
    r.set('SET_SCENE', 0, 0, 1);
    r.to('GO_TO_SCENE', 0, 1);
    expect(gearOf(r).levelAt(r.t + 1000)).toBeGreaterThan(0);
  });
  it('adds to and removes from groups', () => {
    const r = rig();
    r.to('ADD_TO_GROUP', 0, 1);
    r.to('ADD_TO_GROUP', 0, 12);
    expect(r.ask('QUERY_GROUPS_0_7', 0)).toBe(2);
    expect(r.ask('QUERY_GROUPS_8_15', 0)).toBe(16);
    r.to('REMOVE_FROM_GROUP', 0, 1);
    expect(r.ask('QUERY_GROUPS_0_7', 0)).toBe(0);
    r.to('DAPC', group(12), 150);
    expect(level(r)).toBe(150);
  });
  for (const mode of ['temporary-or-mask', 'temporary-or-actual'] as const) {
    it(`a scene stores colour: ${mode}`, () => {
      const r = rig({ storedColour: mode });
      r.run(tcCommands(short(0), 200, false));
      r.set('SET_SCENE', 0, 150, 1);
      r.run(tcCommands(short(0), 300));
      r.set('SET_SCENE', 0, 150, 2);
      r.to('GO_TO_SCENE', 0, 1);
      const g = gearOf(r);
      expect(Math.round(g.colourAt(r.t + 1).tc)).toBe(200);
      r.run(tcCommands(short(0), 350));
      r.to('GO_TO_SCENE', 0, 2);
      expect(Math.round(g.colourAt(r.t + 1).tc)).toBe(mode === 'temporary-or-mask' ? 350 : 300);
    });
  }
  it('a scene with a masked level can still change colour', () => {
    const r = rig();
    r.to('DAPC', 0, 150);
    r.run(tcCommands(short(0), 200, false));
    r.set('SET_SCENE', 0, 255, 7);
    r.run(tcCommands(short(0), 350));
    r.to('GO_TO_SCENE', 0, 7);
    expect(level(r)).toBe(150);
    expect(Math.round(gearOf(r).colourAt(r.t + 1).tc)).toBe(200);
  });
});

describe('10. queries', () => {
  it('reports status, version, light source and operating mode', () => {
    const r = rig();
    const s0 = decodeStatus(Number(r.ask('QUERY_STATUS', 0)));
    expect(s0.lampOn).toBe(false);
    r.to('DAPC', 0, 100);
    expect(decodeStatus(Number(r.ask('QUERY_STATUS', 0))).lampOn).toBe(true);
    expect(r.ask('QUERY_LAMP_POWER_ON', 0)).toBe(255);
    expect(r.ask('QUERY_LAMP_FAILURE', 0)).toBe('none');
    expect(r.ask('QUERY_VERSION_NUMBER', 0)).toBe(8);
    expect(r.ask('QUERY_LIGHT_SOURCE_TYPE', 0)).toBe(6);
    expect(r.ask('QUERY_OPERATING_MODE', 0)).toBe(0);
    r.set('SET_OPERATING_MODE', 0, 0x80);
    expect(r.ask('QUERY_OPERATING_MODE', 0)).toBe(0);
    expect(r.ask('QUERY_MANUFACTURER_SPECIFIC_MODE', 0)).toBe('none');
    expect(r.ask('QUERY_MISSING_SHORT_ADDRESS', 0)).toBe('none');
  });
  for (const types of ['dt6-and-dt8', 'dt8-only'] as const) {
    it(`device types: ${types}, with nothing in between`, () => {
      const r = rig({ deviceTypes: types });
      if (types === 'dt8-only') {
        expect(r.ask('QUERY_DEVICE_TYPE', 0)).toBe(8);
        expect(r.ask('DT6_QUERY_DIMMING_CURVE', 0)).toBe('none');
        return;
      }
      expect(r.ask('QUERY_DEVICE_TYPE', 0)).toBe(255);
      expect(r.ask('QUERY_NEXT_DEVICE_TYPE', 0)).toBe(6);
      expect(r.ask('QUERY_NEXT_DEVICE_TYPE', 0)).toBe(8);
      expect(r.ask('QUERY_NEXT_DEVICE_TYPE', 0)).toBe(254);
      expect(r.ask('QUERY_DEVICE_TYPE', 0)).toBe(255);
      r.to('QUERY_ACTUAL_LEVEL', 0);
      expect(r.ask('QUERY_NEXT_DEVICE_TYPE', 0)).toBe('none');
    });
  }
  it('C1 reports DT6 only', () => {
    const r = rig({}, 'C1');
    expect(r.ask('QUERY_DEVICE_TYPE', 0)).toBe(6);
    expect(r.ask('DT8_QUERY_COLOUR_TYPE_FEATURES', 0)).toBe('none');
  });
  it('reads memory bank 0 and moves DTR0 on', () => {
    const r = rig();
    r.dtr(1, 0);
    r.dtr(0, 0x16);
    expect(r.ask('READ_MEMORY_LOCATION', 0)).toBe(8);
    expect(r.ask('QUERY_CONTENT_DTR0', 0)).toBe(0x17);
    r.dtr(0, 0x60);
    expect(r.ask('READ_MEMORY_LOCATION', 0)).toBe('none');
    r.dtr(1, 3);
    expect(r.ask('READ_MEMORY_LOCATION', 0)).toBe('none');
    r.to('ENABLE_WRITE_MEMORY', 0);
    r.dtr(1, 0);
    expect(r.send({ id: 'WRITE_MEMORY_LOCATION', value: 1 }).kind).toBe('none');
  });
});

describe('11. DT8 colour', () => {
  it('Tc: temporary, ACTIVATE, the colour type and status', () => {
    const r = rig();
    expect(r.ask('DT8_QUERY_COLOUR_TYPE_FEATURES', 0)).toBe(0x02);
    r.to('DAPC', 0, 200);
    r.run(tcCommands(short(0), 250));
    const g = gearOf(r);
    expect(Math.round(g.colourAt(r.t).tc)).toBe(250);
    expect(Number(r.ask('DT8_QUERY_COLOUR_STATUS', 0)) & 0x20).toBe(0x20);
    const out = g.outputAt(r.t);
    const ww = out.terminals[0] ?? 0;
    const cw = out.terminals[1] ?? 0;
    expect(ww + cw).toBeCloseTo(arcToFraction(200), 9);
    expect(out.terminals[4]).toBe(0);
  });
  for (const mode of ['clamp-and-flag', 'ignore'] as const) {
    it(`Tc outside the limits: ${mode}`, () => {
      const r = rig({ tcOutOfLimits: mode });
      r.run(tcCommands(short(0), 300));
      r.run(tcCommands(short(0), 1000));
      const tc = Math.round(gearOf(r).colourAt(r.t).tc);
      expect(tc).toBe(mode === 'clamp-and-flag' ? 370 : 300);
      expect(Number(r.ask('DT8_QUERY_COLOUR_STATUS', 0)) & 2).toBe(2);
    });
  }
  for (const cleared of [true, false]) {
    it(`temporary colour after ACTIVATE is ${cleared ? 'cleared' : 'kept'}`, () => {
      const r = rig({ temporaryClearedAfterActivate: cleared });
      r.run(tcCommands(short(0), 300));
      r.dtr(0, 208);
      expect(r.ask('DT8_QUERY_COLOUR_VALUE', 0)).toBe(cleared ? 0xff : 0x20);
    });
  }
  for (const mode of ['fade-time', 'instant'] as const) {
    it(`colour change: ${mode}`, () => {
      const r = rig({ colourFade: mode });
      r.set('SET_FADE_TIME', 0, 4);
      r.run(tcCommands(short(0), 200));
      r.wait(3000);
      r.run(tcCommands(short(0), 300));
      const tc = gearOf(r).colourAt(r.t + 1000).tc;
      if (mode === 'fade-time') expect(tc).toBeCloseTo(250, 0);
      else expect(tc).toBe(300);
    });
  }
  it('automatic activation applies a pending colour with the next level command', () => {
    const r = rig();
    r.run(tcCommands(short(0), 200, false));
    expect(Math.round(gearOf(r).colourAt(r.t).tc)).toBe(370);
    r.to('DAPC', 0, 150);
    expect(Math.round(gearOf(r).colourAt(r.t).tc)).toBe(200);
    r.dtr(0, 0);
    r.to('DT8_STORE_GEAR_FEATURES', 0);
    expect(r.ask('DT8_QUERY_GEAR_FEATURES', 0)).toBe(0);
    r.run(tcCommands(short(0), 300, false));
    r.to('DAPC', 0, 160);
    expect(Math.round(gearOf(r).colourAt(r.t).tc)).toBe(200);
    r.to('DT8_ACTIVATE', 0);
    expect(Math.round(gearOf(r).colourAt(r.t).tc)).toBe(300);
  });
  it('Tc steps one mirek within the limits', () => {
    const r = rig();
    r.run(tcCommands(short(0), 155));
    r.to('DT8_TC_STEP_COOLER', 0);
    r.to('DT8_TC_STEP_COOLER', 0);
    expect(Math.round(gearOf(r).colourAt(r.t).tc)).toBe(154);
    r.to('DT8_TC_STEP_WARMER', 0);
    expect(Math.round(gearOf(r).colourAt(r.t).tc)).toBe(155);
  });
  it('reads Tc limits and stores new ones', () => {
    const r = rig();
    const read16 = (sel: number) => {
      r.dtr(0, sel);
      const hi = Number(r.ask('DT8_QUERY_COLOUR_VALUE', 0));
      const lo = Number(r.ask('QUERY_CONTENT_DTR0', 0));
      return (hi << 8) | lo;
    };
    expect([read16(128), read16(129), read16(130), read16(131)]).toEqual([154, 154, 370, 370]);
    r.dtr(0, 250);
    r.dtr(1, 0);
    r.dtr(2, 1);
    r.to('DT8_STORE_TC_LIMIT', 0);
    expect(read16(130)).toBe(250);
    r.run(tcCommands(short(0), 360));
    expect(Math.round(gearOf(r).colourAt(r.t).tc)).toBe(250);
    expect(read16(2)).toBe(250);
    expect(read16(0)).toBe(0xffff);
  });
  it('COPY REPORT TO TEMPORARY', () => {
    const r = rig();
    r.run(tcCommands(short(0), 222));
    r.to('DT8_COPY_REPORT_TO_TEMPORARY', 0);
    r.dtr(0, 194);
    expect(r.ask('DT8_QUERY_COLOUR_VALUE', 0)).toBe(0);
    expect(r.ask('QUERY_CONTENT_DTR0', 0)).toBe(222);
  });
  for (const law of ['constant-total', 'both-high-middle'] as const) {
    it(`Tc mixing law: ${law}`, () => {
      const r = rig({ tcMix: law });
      r.to('DAPC', 0, 254);
      r.run(tcCommands(short(0), 262));
      const t = gearOf(r).outputAt(r.t).terminals;
      const sum = (t[0] ?? 0) + (t[1] ?? 0);
      expect(sum).toBeCloseTo(law === 'constant-total' ? 1 : 2, 2);
    });
  }
  for (const law of ['linear', 'curve'] as const) {
    it(`RGBWAF channel law: ${law}`, () => {
      const r = rig({ channelLaw: law }, 'C5', 'rgbwaf');
      r.to('DAPC', 0, 254);
      r.run(rgbwafCommands(short(0), [127, 0, 0, 0, 0, 255]));
      const red = gearOf(r).outputAt(r.t).terminals[0] ?? 0;
      expect(red).toBeCloseTo(law === 'linear' ? 0.5 : arcToFraction(127), 3);
    });
  }
  it('C5 as RGBWAF: five channels, assigned colours, W warm and A cool', () => {
    const r = rig({}, 'C5', 'rgbwaf');
    expect(r.ask('DT8_QUERY_COLOUR_TYPE_FEATURES', 0)).toBe(0xa0);
    const assigned = [0, 1, 2, 3, 4, 5].map((c) => {
      r.dtr(0, c);
      return r.ask('DT8_QUERY_ASSIGNED_COLOUR', 0);
    });
    expect(assigned).toEqual([1, 2, 3, 4, 5, 255]);
    r.to('DAPC', 0, 254);
    r.run(rgbwafCommands(short(0), [0, 0, 0, 254, 0, 255]));
    const out = gearOf(r).outputAt(r.t);
    expect(out.labels).toEqual(['R', 'G', 'B', 'WW', 'CW']);
    expect(out.terminals.map((x) => Math.round(x))).toEqual([0, 0, 0, 1, 0]);
    r.dtr(0, 12);
    expect(r.ask('DT8_QUERY_COLOUR_VALUE', 0)).toBe(254);
    r.dtr(0, 15);
    expect(r.ask('DT8_QUERY_COLOUR_VALUE', 0)).toBe(0);
    expect(r.ask('DT8_QUERY_RGBWAF_CONTROL', 0)).toBe(0);
    r.dtr(0, 240);
    expect(r.ask('DT8_QUERY_COLOUR_VALUE', 0)).toBe(0x80);
    r.dtr(0, 99);
    expect(r.ask('DT8_QUERY_COLOUR_VALUE', 0)).toBe(255);
  });
  it('C5 as Tc beside RGB', () => {
    const r = rig({}, 'C5', 'tc');
    expect(r.ask('DT8_QUERY_COLOUR_TYPE_FEATURES', 0)).toBe(0x62);
    r.to('DAPC', 0, 254);
    r.run(tcCommands(short(0), 370));
    const out = gearOf(r).outputAt(r.t);
    expect(out.terminals[3]).toBeCloseTo(1, 6);
    expect(out.terminals[4]).toBeCloseTo(0, 6);
  });
  it('C2 as RGBWAF with two channels ignores Tc commands', () => {
    const r = rig({}, 'C2', 'rgbwaf');
    expect(r.ask('DT8_QUERY_COLOUR_TYPE_FEATURES', 0)).toBe(0x40);
    r.to('DAPC', 0, 254);
    r.run(rgbwafCommands(short(0), [0, 254, 255, 255, 255, 255]));
    r.run(tcCommands(short(0), 370));
    const out = gearOf(r).outputAt(r.t);
    expect(out.terminals.slice(0, 2).map((x) => Math.round(x))).toEqual([0, 1]);
    r.dtr(0, 9);
    expect(r.ask('DT8_QUERY_COLOUR_VALUE', 0)).toBe(0);
  });
  it('C3 and C4 present three and four channels', () => {
    expect(rig({}, 'C3').ask('DT8_QUERY_COLOUR_TYPE_FEATURES', 0)).toBe(0x60);
    expect(rig({}, 'C4').ask('DT8_QUERY_COLOUR_TYPE_FEATURES', 0)).toBe(0x80);
  });
  it('RGBWAF control is stored on ACTIVATE', () => {
    const r = rig({}, 'C5', 'rgbwaf');
    r.dtr(0, 0x41);
    r.to('DT8_SET_TEMPORARY_RGBWAF_CONTROL', 0);
    r.to('DT8_ACTIVATE', 0);
    expect(r.ask('DT8_QUERY_RGBWAF_CONTROL', 0)).toBe(0x41);
  });
  it('a stored power-on colour is applied at power-up', () => {
    const r = rig();
    r.run(tcCommands(short(0), 360, false));
    r.set('SET_POWER_ON_LEVEL', 0, 120);
    r.run(tcCommands(short(0), 160));
    const g = gearOf(r);
    g.powerDown(r.t);
    g.powerUp(r.t + 10);
    r.wait(1000);
    expect(Math.round(g.colourAt(r.t).tc)).toBe(360);
  });
});

describe('12. DT6', () => {
  for (const accepts of [true, false]) {
    it(`SELECT DIMMING CURVE to linear is ${accepts ? 'honoured' : 'ignored'}`, () => {
      const r = rig({ acceptsLinearCurve: accepts, physicalMinimum: 1 }, 'C1');
      r.set('DT6_SELECT_DIMMING_CURVE', 0, 1);
      expect(r.ask('DT6_QUERY_DIMMING_CURVE', 0)).toBe(accepts ? 1 : 0);
      r.to('DAPC', 0, 127);
      const d = gearOf(r).outputAt(r.t).terminals[0] ?? 0;
      expect(d).toBeCloseTo(accepts ? 0.5 : arcToFraction(127), 2);
    });
  }
  it('answers its fixed queries', () => {
    const r = rig();
    expect(r.ask('DT6_QUERY_GEAR_TYPE', 0)).toBe(0);
    expect(r.ask('DT6_QUERY_POSSIBLE_OPERATING_MODES', 0)).toBe(1);
    expect(r.ask('DT6_QUERY_EXTENDED_VERSION_NUMBER', 0)).toBe(2);
    expect(r.ask('DT8_QUERY_EXTENDED_VERSION_NUMBER', 0)).toBe(2);
    expect(r.ask('DT6_QUERY_SHORT_CIRCUIT', 0)).toBe('none');
  });
});

describe('13. commissioning', () => {
  it('the INITIALISE window closes after 15 minutes, and TERMINATE closes it', () => {
    const sim = Simulator.of([
      { id: 'X', profile: da5l('C2'), opts: { randomPreload: [0x000100] } },
    ]);
    const r = new Rig(sim);
    r.send({ id: 'INITIALISE', value: 0xff });
    r.send({ id: 'RANDOMISE' });
    r.send({ id: 'SEARCHADDRH', value: 0 });
    r.send({ id: 'SEARCHADDRM', value: 1 });
    r.send({ id: 'SEARCHADDRL', value: 0 });
    expect(r.send({ id: 'COMPARE' }).kind).toBe('value');
    expect(r.send({ id: 'QUERY_SHORT_ADDRESS' })).toEqual({ kind: 'value', byte: 0xff });
    r.send({ id: 'PROGRAM_SHORT_ADDRESS', value: (9 << 1) | 1 });
    expect(r.send({ id: 'VERIFY_SHORT_ADDRESS', value: (9 << 1) | 1 }).kind).toBe('value');
    expect(r.send({ id: 'QUERY_SHORT_ADDRESS' })).toEqual({ kind: 'value', byte: 19 });
    r.wait(16 * 60_000);
    expect(r.send({ id: 'COMPARE' }).kind).toBe('none');
    r.send({ id: 'INITIALISE', value: 0 });
    r.send({ id: 'TERMINATE' });
    expect(r.send({ id: 'COMPARE' }).kind).toBe('none');
    expect(r.ask('QUERY_RANDOM_ADDRESS_M', 9)).toBe(1);
  });
  it('SET SHORT ADDRESS from DTR0, and clearing it', () => {
    const r = rig();
    r.set('SET_SHORT_ADDRESS', 0, (5 << 1) | 1);
    expect(r.ask('QUERY_CONTROL_GEAR_PRESENT', 5)).toBe(255);
    r.set('SET_SHORT_ADDRESS', 5, 0x02);
    expect(r.ask('QUERY_CONTROL_GEAR_PRESENT', 5)).toBe(255);
    r.set('SET_SHORT_ADDRESS', 5, 0xff);
    expect(r.ask('QUERY_MISSING_SHORT_ADDRESS', unaddressed)).toBe(255);
  });
  it('random addresses come from a seeded generator, so forks agree', () => {
    const sim = Simulator.of([{ id: 'X', profile: da5l('C2'), opts: { seed: 42 } }]);
    const r = new Rig(sim);
    r.send({ id: 'INITIALISE', value: 0 });
    const fork = sim.fork();
    r.send({ id: 'RANDOMISE' });
    fork.send({ frame: { a: 0xa7, b: 0 }, sendTwice: true, expectReply: false }, r.t - 40);
    const a = sim.unit('X')?.gear.snapshot().randomAddress;
    const b = fork.unit('X')?.gear.snapshot().randomAddress;
    expect(a).toBe(b);
    expect(a).not.toBe(0xffffff);
  });
});

describe('the simulator', () => {
  it('forks are independent', () => {
    const r = twoGear();
    const fork = r.sim.fork();
    r.to('DAPC', 0, 200);
    expect(fork.unit('A')?.gear.levelAt(r.t)).toBe(0);
    expect(r.sim.unit('A')?.gear.levelAt(r.t)).toBe(200);
  });
  it('outputAt reads the past and changes nothing', () => {
    const r = rig();
    r.to('DAPC', 0, 200);
    const t1 = r.t;
    r.wait(1000);
    r.to('OFF', 0);
    const g = gearOf(r);
    const before = JSON.stringify(g.snapshot());
    expect(g.levelAt(t1 + 10)).toBe(200);
    expect(
      r.sim
        .outputAt(t1 + 10)
        .get('A')
        ?.terminals.some((x) => x > 0),
    ).toBe(true);
    expect(JSON.stringify(g.snapshot())).toBe(before);
  });
  it('powers and drops the bus for every unit', () => {
    const r = twoGear();
    r.to('DAPC', broadcast, 200);
    r.sim.busDown(r.t);
    r.sim.busUp(r.t + 100);
    r.sim.powerDown(r.t + 200);
    expect(r.sim.unit('B')?.gear.levelAt(r.t + 300)).toBe(0);
    r.sim.powerUp(r.t + 400);
    expect(r.sim.settlesAt()).toBeGreaterThan(r.t);
    expect(r.sim.byShortAddress(1)?.id).toBe('B');
    expect(r.sim.reached(broadcast)).toHaveLength(2);
    expect(r.sim.unit('Z')).toBeUndefined();
  });
});
