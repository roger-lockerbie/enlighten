/**
 * U-safety: the governor's settings, read-back checks, rules and ceiling measure, each checked to the
 * exact outcome. Written against the Stage 3 mutation run (`docs/MUTATION.md`).
 */
import { describe, expect, it } from 'vitest';
import { broadcast, group, short, unaddressed, type Address } from '../dali/address.ts';
import { encode, type Command } from '../dali/codec.ts';
import { arcToFraction } from '../dali/curve.ts';
import {
  framesFor,
  framesForAll,
  rgbwafCommands,
  tcCommands,
  type TxFrame,
} from '../dali/sequences.ts';
import { asSubmit, makeBench } from '../../tests/harness/bench.ts';
import { raiseCeiling } from './ceiling.ts';
import { Rig } from '../sim/rig.ts';
import { da5l } from '../sim/profile.ts';
import { Simulator } from '../sim/simulator.ts';
import { Governor } from './governor.ts';
import type { SendResult, Source, Transaction, Verdict } from './types.ts';

const A = short(0);
const B = short(1);
const c = (id: string, address?: Address, value?: number): Command => ({
  id,
  ...(address === undefined ? {} : { address }),
  ...(value === undefined ? {} : { value }),
});
const tx = (cmds: readonly Command[], source: Source = 'ui'): Transaction => ({
  frames: framesForAll(cmds),
  source,
});
const one = (cmd: Command): TxFrame => {
  const e = encode(cmd);
  return { frame: e.frame, sendTwice: e.sendTwice, expectReply: e.reply !== 'none' };
};
const reason = (v: Verdict): string => (v.kind === 'refuse' ? v.reason : '');
const OK = { ok: true };
const no = (r: string) => ({ ok: false, reason: r });

function bare(target: 'simulator' | 'hardware' = 'simulator', shadow = Simulator.bench()) {
  return new Governor({ target, shadow, connectedAt: -10_000 });
}

/** Tell the governor a command went out, with what came back for its last frame. */
function tell(g: Governor, cmd: Command, result: SendResult = { kind: 'sent' }, at = 100): void {
  const frames = framesFor(cmd);
  frames.forEach((f, i) => {
    g.observe(
      { frame: f, at: at + i, source: 'internal' },
      i === frames.length - 1 ? result : { kind: 'sent' },
    );
  });
}
const reply = (byte: number): SendResult => ({ kind: 'reply', byte });
const present = (g: Governor, a: Address) => {
  tell(g, c('QUERY_CONTROL_GEAR_PRESENT', a), reply(255));
};

describe('replies to more than one address', () => {
  it('teach nothing about one address, and only QUERY MISSING SHORT ADDRESS finds unaddressed gear', () => {
    const g = bare('hardware', new Simulator([]));
    const unaddressedPresent = () =>
      (JSON.parse(g.fingerprint()) as { unaddressedPresent: boolean }).unaddressedPresent;
    expect(unaddressedPresent()).toBe(false);
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', broadcast), reply(255));
    tell(g, c('QUERY_STATUS', unaddressed), reply(0));
    expect(g.knownAddresses()).toEqual([]);
    expect(unaddressedPresent()).toBe(false);
    tell(g, c('QUERY_MISSING_SHORT_ADDRESS', broadcast), reply(255));
    expect(unaddressedPresent()).toBe(true);
  });
});

describe('the ceiling measure inside a fade', () => {
  it('finds a peak between breakpoints, where the level fades up as the colour mix fades down', async () => {
    const b = makeBench();
    await b.ready();
    await b.clock.advance(3000);
    const r = new Rig(b.sim, b.clock.now());
    r.run(rgbwafCommands(B, [254, 254, 254, 254, 254, 254]));
    r.to('DAPC', B, 158);
    r.set('SET_FADE_TIME', 1, 7);
    r.wait(100);
    const at = r.t;
    // At every breakpoint the measure is at most 0.92 of the ceiling. Part way through it is 1.07.
    r.run([...rgbwafCommands(B, [0, 0, 0, 0, 0, 0]), { id: 'DAPC', address: B, value: 220 }]);
    expect(b.governor.overCeiling(1, at)).toBe(true);
  });
});

describe('the ceiling setting', () => {
  it('takes whole arc levels from 1 to 254 only', () => {
    const g = bare();
    const bad = no('The ceiling must be an arc level from 1 to 254.');
    expect(g.setCeiling(0, 'ui')).toEqual(bad);
    expect(g.setCeiling(255, 'ui', true)).toEqual(bad);
    expect(g.setCeiling(1.5, 'ui')).toEqual(bad);
    expect(g.setCeiling(254, 'ui', true)).toEqual(OK);
    expect(g.setCeiling(1, 'ui')).toEqual(OK);
    expect(g.ceilingArc).toBe(1);
  });
  it('a governor cannot start with a ceiling outside 1 to 254', () => {
    const make = (ceilingArc: number) => () =>
      new Governor({ target: 'simulator', shadow: Simulator.bench(), ceilingArc });
    for (const bad of [0, 255, 1.5, Number.NaN]) {
      expect(make(bad)).toThrow('The ceiling must be an arc level from 1 to 254.');
    }
    expect(make(1)().ceilingArc).toBe(1);
    expect(make(254)().ceilingArc).toBe(254);
  });
  it('raising needs a confirmed person, and setting the same value does not', () => {
    const g = bare();
    const raise = no('Raising the ceiling needs a confirmation from a person.');
    expect(g.setCeiling(230, 'script', true)).toEqual(raise);
    expect(g.setCeiling(230, 'ui')).toEqual(raise);
    expect(g.setCeiling(220, 'script')).toEqual(OK);
    expect(g.setCeiling(230, 'console', true)).toEqual(OK);
  });
  it('the lowest ceiling is the highest physical minimum of gear that is present', () => {
    const g = bare();
    present(g, A);
    tell(g, c('QUERY_PHYSICAL_MINIMUM', A), reply(85));
    // An address that has not answered QUERY CONTROL GEAR PRESENT does not count.
    tell(g, c('QUERY_PHYSICAL_MINIMUM', short(5)), reply(170));
    expect(g.setCeiling(85, 'ui')).toEqual(OK);
    const pct = (arcToFraction(85) * 100).toFixed(2);
    expect(g.setCeiling(84, 'ui')).toEqual(
      no(
        `A driver cannot go below arc level 85 (${pct}%). That is the lowest ceiling it can hold.`,
      ),
    );
  });
  it('an address stays verified only while its MAX LEVEL is known and at or under the ceiling', async () => {
    const b = makeBench();
    await b.ready();
    const g = b.governor;
    expect(g.setCeiling(220, 'ui')).toEqual(OK);
    expect([g.addressInfo(0)?.verified, g.addressInfo(1)?.verified]).toEqual([true, true]);
    // MAX LEVEL is known again only once read back.
    tell(g, c('SET_MAX_LEVEL', A), { kind: 'sent' }, b.clock.now());
    expect(g.addressInfo(0)?.maxLevel).toBeUndefined();
    expect(g.setCeiling(220, 'ui')).toEqual(OK);
    expect([g.addressInfo(0)?.verified, g.addressInfo(1)?.verified]).toEqual([false, true]);
    expect(g.setCeiling(219, 'ui')).toEqual(OK);
    expect(g.addressInfo(1)?.verified).toBe(false);
  });
});

describe('unlocks, the swing limit and resume', () => {
  it('an unlock needs a confirmed person, and the rate unlock needs the operator to see', () => {
    const g = bare();
    const conf = no('An unlock needs a typed confirmation from a person.');
    expect(g.unlock('reset', 'script', true)).toEqual(conf);
    expect(g.unlock('reset', 'ui', false)).toEqual(conf);
    expect(g.unlock('rate', 'ui', true)).toEqual(OK);
    expect(g.setOperatorCanSee(true, 'script')).toEqual(
      no('Only the operator can answer whether they can see the lights.'),
    );
    expect(g.isUnlocked('rate')).toBe(true);
    expect(g.setOperatorCanSee(false, 'ui')).toEqual(OK);
    expect(g.isUnlocked('rate')).toBe(false);
    expect(g.unlock('rate', 'ui', true)).toEqual(
      no(
        'The operator said they cannot see the lights, so the rate unlock is off for this session.',
      ),
    );
    expect(g.unlock('expert', 'ui', true)).toEqual(OK);
  });
  it('the swing limit is 1 to 3, raised only with the rate unlock, and drops back when it is locked', () => {
    const g = bare();
    expect(g.setSwingLimit(2, 'script')).toEqual(no('Only a person can change the swing limit.'));
    expect(g.setSwingLimit(1, 'ui')).toEqual(OK);
    expect(g.setSwingLimit(2, 'ui')).toEqual(no('Raising the swing limit needs the rate unlock.'));
    g.unlock('rate', 'ui', true);
    const range = no('The swing limit is a whole number from 1 to 3.');
    for (const n of [0, 4, 1.5]) expect(g.setSwingLimit(n, 'ui')).toEqual(range);
    expect(g.setSwingLimit(3, 'ui')).toEqual(OK);
    expect(g.swingLimit).toBe(3);
    g.lock('rate');
    g.unlock('rate', 'ui', true);
    expect(g.swingLimit).toBe(1);
  });
  it('only a person can resume', () => {
    const g = bare();
    g.latch();
    expect(g.resume('script')).toEqual(no('Only a person can resume after panic.'));
    expect(g.resume('ui')).toEqual(OK);
  });
});

describe('verifying an address from its read-backs', () => {
  const good = { max: 200, min: 90, powerOn: 0, systemFailure: 255, linear: false };
  const seen = () => {
    const g = bare();
    tell(g, c('QUERY_MAX_LEVEL', A), reply(200));
    tell(g, c('QUERY_MIN_LEVEL', A), reply(90));
    return g;
  };
  it('refuses each read-back that shows the profile is not in place', () => {
    const g = seen();
    expect(g.markVerified(0, { ...good, linear: true })).toEqual(
      no('The dimming curve is not standard.'),
    );
    expect(g.markVerified(0, { ...good, max: 230 })).toEqual(
      no('MAX LEVEL reads 230, above the ceiling.'),
    );
    expect(g.markVerified(0, { ...good, min: 201 })).toEqual(
      no('MIN LEVEL reads above MAX LEVEL.'),
    );
    expect(g.markVerified(0, { ...good, powerOn: 5 })).toEqual(
      no('POWER ON LEVEL reads 5, not 0.'),
    );
    expect(g.markVerified(0, { ...good, systemFailure: 0 })).toEqual(
      no('SYSTEM FAILURE LEVEL reads 0, not 255.'),
    );
    expect(g.addressInfo(0)?.verified).toBe(false);
  });
  it('refuses read-backs that differ from what the governor saw on the bus', () => {
    const g = seen();
    const mismatch = no('The read-back does not match what the governor saw on the bus.');
    expect(g.markVerified(0, { ...good, max: 210 })).toEqual(mismatch);
    expect(g.markVerified(0, { ...good, min: 85 })).toEqual(mismatch);
    tell(g, c('DT6_QUERY_DIMMING_CURVE', A), reply(1));
    expect(g.markVerified(0, good)).toEqual(mismatch);
    tell(g, c('DT6_QUERY_DIMMING_CURVE', A), reply(0));
    expect(g.markVerified(0, good)).toEqual(OK);
    expect(g.addressInfo(0)?.verified).toBe(true);
  });
  it('accepts MIN LEVEL equal to MAX LEVEL', () => {
    const g = bare();
    tell(g, c('QUERY_MAX_LEVEL', B), reply(150));
    tell(g, c('QUERY_MIN_LEVEL', B), reply(150));
    expect(g.markVerified(1, { ...good, max: 150, min: 150 })).toEqual(OK);
  });
});

describe('rules, to the exact outcome', () => {
  it('a DAPC clamp carries one note, and other values above the ceiling are not touched', async () => {
    const b = makeBench();
    await b.ready();
    const v = b.governor.judge(tx([c('DAPC', A, 254)]), b.clock.now() + 5000);
    expect(v.kind === 'clamp' ? v.note : v.kind).toBe('DAPC 254 clamped to the ceiling, 220.');
    expect(b.governor.judge(tx([c('DTR0', undefined, 254)]), b.clock.now()).kind).toBe('allow');
    const two = b.governor.judge(tx([c('DAPC', A, 254), c('DAPC', B, 230)]), b.clock.now() + 5000);
    expect(two.kind === 'clamp' ? two.note : two.kind).toBe(
      'DAPC 254 clamped to the ceiling, 220. DAPC 230 clamped to the ceiling, 220.',
    );
  });
  it('a frame whose flags do not match its command is refused with the reason', () => {
    const g = bare();
    const off = one(c('OFF', A));
    const bad = 'OFF: the send-twice or reply flag does not match the command.';
    expect(reason(g.judge({ frames: [{ ...off, sendTwice: true }], source: 'ui' }, 0))).toBe(bad);
    expect(reason(g.judge({ frames: [{ ...off, expectReply: true }], source: 'ui' }, 0))).toBe(bad);
  });
  it('commands behind an unlock are judged by the unlock, even on unverified gear', () => {
    const g = bare();
    present(g, A);
    const d = [c('DTR0', undefined, 1), c('DTR1', undefined, 1), c('DTR2', undefined, 1)];
    expect(reason(g.judge(tx([c('RESET', A)], 'console'), 0))).toBe(
      'RESET: needs the reset unlock.',
    );
    expect(reason(g.judge(tx([...d, c('DT8_STORE_TC_LIMIT', A)], 'console'), 0))).toMatch(
      /: needs the expert unlock\.$/,
    );
    expect(reason(g.judge(tx([...d, c('DT6_SELECT_DIMMING_CURVE', A)], 'console'), 0))).toBe(
      'SELECT DIMMING CURVE: needs the expert unlock.',
    );
    g.unlock('reset', 'ui', true);
    expect(reason(g.judge(tx([c('RESET', A)], 'script'), 0))).toBe(
      'RESET: accepted only from a person at the console or the UI.',
    );
    expect(reason(g.judge(tx([c('DOWN', A)]), 0))).toBe('DOWN: Address 0 is not verified.');
    expect(reason(g.judge(tx([c('RESET', A)], 'console'), 0))).not.toMatch(/not verified/);
    expect(
      reason(g.judge(tx([c('DTR0', undefined, 5), c('SET_SHORT_ADDRESS', A)], 'console'), 0)),
    ).not.toMatch(/not verified/);
  });
  it('SET MAX LEVEL counts 255 as 254, and limits equal to the ceiling pass', () => {
    const g = bare();
    g.setCeiling(254, 'ui', true);
    const above = /the value is above the ceiling/;
    expect(
      reason(g.judge(tx([c('DTR0', undefined, 255), c('SET_MAX_LEVEL', A)], 'profile'), 0)),
    ).not.toMatch(above);
    g.setCeiling(200, 'ui');
    for (const id of ['SET_MIN_LEVEL', 'SET_POWER_ON_LEVEL', 'SET_MAX_LEVEL']) {
      expect(reason(g.judge(tx([c('DTR0', undefined, 200), c(id, A)], 'profile'), 0))).not.toMatch(
        above,
      );
      expect(reason(g.judge(tx([c('DTR0', undefined, 201), c(id, A)], 'profile'), 0))).toMatch(
        above,
      );
    }
  });
  it('colour commands to gear that has not reported colour are refused, short or group', () => {
    const g = bare();
    present(g, A);
    present(g, B);
    expect(reason(g.judge(tx(tcCommands(short(5), 250, false), 'profile'), 0))).toMatch(
      /the gear does not report Tc\.$/,
    );
    expect(
      reason(g.judge(tx(rgbwafCommands(short(5), [1, 1, 1, 1, 1, 1], false), 'profile'), 0)),
    ).toMatch(/the gear does not report RGBWAF\.$/);
    expect(reason(g.judge(tx(tcCommands(group(1), 250, false), 'profile'), 0))).toMatch(
      /not every addressed gear reports Tc\.$/,
    );
    expect(
      reason(g.judge(tx(rgbwafCommands(group(1), [1, 1, 1, 1, 1, 1], false), 'profile'), 0)),
    ).toMatch(/not every addressed gear reports RGBWAF\.$/);
  });
  it('colour commands to a group are allowed when every member supports them', async () => {
    const real = Simulator.bench();
    const r = new Rig(real);
    r.to('ADD_TO_GROUP', 0, 3);
    r.to('ADD_TO_GROUP', 1, 3);
    r.to('ADD_TO_GROUP', 0, 4);
    r.to('ADD_TO_GROUP', 1, 5);
    const b = makeBench({ sim: real });
    await b.ready();
    const at = b.clock.now();
    expect(reason(b.governor.judge(tx(tcCommands(group(4), 250, false)), at))).toBe('');
    expect(reason(b.governor.judge(tx(tcCommands(group(3), 250, false)), at))).toMatch(
      /not every addressed gear reports Tc/,
    );
    const ch = [1, 1, 1, 1, 1, 1] as const;
    expect(reason(b.governor.judge(tx(rgbwafCommands(group(5), ch, false)), at))).toBe('');
    expect(reason(b.governor.judge(tx(rgbwafCommands(group(3), ch, false)), at))).toMatch(
      /not every addressed gear reports RGBWAF/,
    );
  });
  it('a group reaches its members and gear whose groups are not known', () => {
    const g = bare();
    present(g, A);
    present(g, B);
    tell(g, c('QUERY_GROUPS_0_7', A), reply(0b1000));
    tell(g, c('QUERY_GROUPS_8_15', A), reply(0));
    tell(g, c('QUERY_GROUPS_0_7', B), reply(0));
    tell(g, c('QUERY_GROUPS_8_15', B), reply(0));
    g.markInventoryFresh(false);
    expect(reason(g.judge(tx([c('DOWN', group(3))]), 0))).toBe('DOWN: Address 0 is not verified.');
    expect(reason(g.judge(tx([c('DOWN', group(5))]), 0))).not.toMatch(/not verified/);
    present(g, short(2));
    expect(reason(g.judge(tx([c('DOWN', group(5))]), 0))).toBe('DOWN: Address 2 is not verified.');
  });
  it('a frame to gear without a short address reaches no known address', () => {
    const g = bare();
    present(g, A);
    const before = JSON.parse(g.fingerprint()) as { info: unknown };
    tell(g, c('OFF', unaddressed));
    expect((JSON.parse(g.fingerprint()) as { info: unknown }).info).toEqual(before.info);
  });
  it('new addresses start known in the Simulator target and unknown on hardware', () => {
    const s = bare();
    present(s, A);
    const si = s.addressInfo(0);
    expect([si?.levelKnown, si?.colourKnown, si?.modelled]).toEqual([true, true, true]);
    const h = bare('hardware');
    present(h, A);
    const hi = h.addressInfo(0);
    expect([hi?.levelKnown, hi?.colourKnown, hi?.modelled]).toEqual([false, false, false]);
  });
});

describe('the OFF that follows an unlocked RESET', () => {
  it('only an OFF to the reset gear is the follow-up, and only on its own', async () => {
    const b = makeBench();
    await b.ready();
    await b.clock.advance(3000);
    b.governor.unlock('reset', 'console', true);
    expect((await b.run(tx([c('RESET', A)], 'console'))).kind).toBe('done');
    // After the gear's 300 ms of deafness, inside the RESET's 2 s.
    const at = b.clock.now() + 400;
    expect(b.governor.judge(tx([c('OFF', A)]), at).kind).toBe('allow');
    // A level is judged with the OFF the RESET is waiting to send (DALI review of ADR 0015): back on
    // straight after it is a second hard step.
    expect(b.governor.judge(tx([c('DAPC', A, 200)]), at).kind).toBe('refuse');
    expect(b.governor.judge(tx([c('OFF', A), c('DAPC', A, 200)]), at).kind).toBe('refuse');
    const fp = JSON.parse(b.governor.fingerprint()) as { resetOff: unknown };
    expect(fp.resetOff).toEqual({ targets: [0], until: expect.any(Number) as number });
    tell(b.governor, c('OFF', A), { kind: 'sent' }, at);
    expect((JSON.parse(b.governor.fingerprint()) as { resetOff: unknown }).resetOff).toEqual({
      targets: [],
      until: expect.any(Number) as number,
    });
  });
  it('judges a change made before the OFF with the OFF that will follow it', async () => {
    // A is at full, so the RESET makes no jump and its OFF is its one hard step. A level for A judged
    // before the OFF goes would follow it out (the OFF jumps the queue): full, off, then back on, a
    // flash the guard did not see while it judged the level without the OFF (DALI review of ADR 0015).
    const b = makeBench();
    await b.ready();
    await b.clock.advance(3000);
    b.governor.unlock('rate', 'ui', true);
    b.governor.setSwingLimit(3, 'ui');
    expect((await b.drive(raiseCeiling(b.governor, 254, asSubmit(b), 'ui', true))).ok).toBe(true);
    expect((await b.run(tx([c('DAPC', A, 254)]))).kind).toBe('done');
    await b.clock.advance(3000);
    b.governor.unlock('reset', 'console', true);
    expect((await b.run(tx([c('RESET', A)], 'console'))).kind).toBe('done');
    const at = b.clock.now() + 400;
    expect(reason(b.governor.judge(tx([c('DAPC', A, 200)]), at))).toMatch(/hard step|swing/);
  });
  it('still judges with the OFF when it is late, until the follow-up window ends', async () => {
    // On hardware the OFF can go later than 350 ms after the RESET. While it would still pass as the
    // follow-up, every judgement includes it (second DALI review of ADR 0015, finding 2).
    const b = makeBench();
    await b.ready();
    await b.clock.advance(3000);
    b.governor.unlock('rate', 'ui', true);
    b.governor.setSwingLimit(3, 'ui');
    expect((await b.drive(raiseCeiling(b.governor, 254, asSubmit(b), 'ui', true))).ok).toBe(true);
    expect((await b.run(tx([c('DAPC', A, 254)]))).kind).toBe('done');
    await b.clock.advance(3000);
    b.governor.unlock('reset', 'console', true);
    expect((await b.run(tx([c('RESET', A)], 'console'))).kind).toBe('done');
    const t = b.clock.now();
    expect(reason(b.governor.judge(tx([c('DAPC', A, 200)]), t + 750))).toMatch(/hard step|swing/);
    expect(reason(b.governor.judge(tx([c('DAPC', A, 200)]), t + 1900))).toMatch(/hard step|swing/);
  });
  it('a group OFF is not the follow-up, and does not end it', async () => {
    const b = makeBench();
    await b.ready();
    await b.clock.advance(3000);
    await b.run(tx([c('ADD_TO_GROUP', B, 0)]));
    await b.clock.advance(3000);
    // B comes on from off: a hard step for B.
    expect((await b.run(tx([c('DAPC', B, 150)]))).kind).toBe('done');
    await b.clock.advance(1100);
    b.governor.unlock('reset', 'console', true);
    expect((await b.run(tx([c('RESET', A)], 'console'))).kind).toBe('done');
    const at = b.clock.now() + 400;
    // Group 0 holds B, not the reset gear, so its OFF is judged: B's second hard step in 2 s.
    expect(reason(b.governor.judge(tx([c('OFF', group(0))]), at))).toMatch(/hard step/);
    tell(b.governor, c('OFF', group(0)), { kind: 'sent' }, at);
    const fp = JSON.parse(b.governor.fingerprint()) as { resetOff: { targets: number[] } };
    expect(fp.resetOff.targets).toEqual([0]);
  });
  it('after 2 s, an OFF to the reset gear is judged like any other', async () => {
    const b = makeBench();
    await b.ready();
    await b.clock.advance(3000);
    b.governor.unlock('reset', 'console', true);
    expect((await b.run(tx([c('RESET', A)], 'console'))).kind).toBe('done');
    const { until } = (JSON.parse(b.governor.fingerprint()) as { resetOff: { until: number } })
      .resetOff;
    // A went from off to full: the RESET's jump is a hard step. Inside the 2 s the OFF is its
    // follow-up and part of that hard step. After them it is a second hard step within 2 s of it.
    // (A change other than the OFF in that time is judged with the pending OFF, so is held.)
    expect(b.governor.judge(tx([c('OFF', A)]), until - 100).kind).toBe('allow');
    expect(reason(b.governor.judge(tx([c('OFF', A)]), until + 1))).toMatch(/hard step/);
  });
});

describe('the fingerprint', () => {
  it('shows the unlocks', () => {
    const g = bare();
    const before = g.fingerprint();
    g.unlock('expert', 'console', true);
    expect(g.fingerprint()).not.toBe(before);
  });
});

describe('the ceiling measure', () => {
  const fullB = async () => {
    const b = makeBench();
    await b.ready();
    await b.run(tx(rgbwafCommands(B, [254, 254, 254, 254, 254, 255])));
    await b.clock.advance(3000);
    return b;
  };
  it('lowers only the DAPCs to gear that is over, each to what its own mix allows', async () => {
    const b = await fullB();
    const v = b.governor.judge(tx([c('DAPC', A, 200), c('DAPC', B, 200)]), b.clock.now());
    expect(v.kind).toBe('clamp');
    const levels = v.kind === 'clamp' ? v.tx.frames.map((f) => f.frame.b) : [];
    expect(levels[0]).toBe(200);
    expect(levels[1]).toBeLessThan(200);
  });
  it('leaves a DAPC 255 alone, and refuses when only it could bring a mix under the ceiling', async () => {
    const b = makeBench();
    await b.ready();
    await b.run(tx(rgbwafCommands(B, [30, 0, 0, 0, 0, 0])));
    await b.run(tx([c('DAPC', B, 200)]));
    await b.clock.advance(3000);
    const full = rgbwafCommands(B, [254, 254, 254, 254, 254, 255]);
    expect(reason(b.governor.judge(tx([...full, c('DAPC', B, 255)]), b.clock.now()))).toBe(
      'This would take the light above the ceiling.',
    );
  });
  it('does not lower a DAPC to off when even level 1 is over the ceiling', () => {
    // No colour read back: every channel counts as full, so level 1 measures 7 times the ceiling.
    const g = bare();
    expect(g.setCeiling(1, 'ui')).toEqual(OK);
    expect(reason(g.judge(tx([c('DAPC', B, 100)]), 5000))).toBe(
      'This would take the light above the ceiling.',
    );
  });
  it('a pending Tc on gear with Tc and RGB is not judged as an RGBWAF mix', async () => {
    const real = Simulator.of([{ id: 'X', profile: da5l('C5', 'tc'), opts: { shortAddress: 0 } }]);
    const b = makeBench({ sim: real });
    await b.ready();
    await b.run(tx(tcCommands(A, 250, false)));
    const v = b.governor.judge(
      tx([c('DTR0', undefined, 220), c('SET_SCENE', A, 3)]),
      b.clock.now(),
    );
    expect(reason(v)).toBe('');
  });
  it('gear that reported no device types is measured as every channel, gear without DT8 as one', () => {
    const g = bare();
    present(g, B);
    tell(g, c('QUERY_DEVICE_TYPE', B), reply(254));
    expect(g.judge(tx([c('DAPC', B, 220)]), 0).kind).toBe('clamp');
    tell(g, c('QUERY_DEVICE_TYPE', B), reply(6));
    expect(g.judge(tx([c('DAPC', B, 220)]), 0).kind).toBe('allow');
  });
  it('is over the ceiling only above it, not at it', () => {
    const sim = Simulator.bench();
    const g = bare('simulator', sim);
    present(g, A);
    tell(g, c('QUERY_DEVICE_TYPE', A), reply(6));
    const r = new Rig(sim, 0);
    r.to('DAPC', 0, 220);
    expect(g.overCeiling(0, r.t + 1000)).toBe(false);
    r.to('DAPC', 0, 221);
    expect(g.overCeiling(0, r.t + 1000)).toBe(true);
    expect(g.overCeiling(9, r.t + 1000)).toBe(false);
  });
  it('a DAPC of 255 is not changed when the gear is over, and a fitted DAPC carries its note', async () => {
    const b = makeBench();
    await b.ready();
    await b.run(tx(rgbwafCommands(B, [254, 254, 254, 254, 254, 255])));
    await b.clock.advance(3000);
    await b.run(tx([c('DAPC', B, 150)]));
    await b.clock.advance(3000);
    b.governor.setCeiling(200, 'script');
    expect(b.governor.overCeiling(1, b.clock.now())).toBe(true);
    expect(b.governor.judge(tx([c('DAPC', B, 255)]), b.clock.now()).kind).toBe('allow');
    const v = b.governor.judge(tx([c('DAPC', B, 160)]), b.clock.now());
    expect(v.kind === 'clamp' ? v.note : v.kind).toBe(
      'Level lowered so the colour mix stays under the ceiling.',
    );
  });
});

describe('what the governor reports', () => {
  it('colour facts as read back', () => {
    const g = bare();
    tell(g, c('DT8_QUERY_COLOUR_TYPE_FEATURES', A), reply(0x62));
    expect(g.colourFacts(0)).toEqual({ tc: true, channels: 3 });
    expect(g.colourFacts(9)).toBeUndefined();
  });
  it('panic frames are recorded like any other', () => {
    const g = bare('hardware');
    present(g, A);
    expect(g.addressInfo(0)?.levelKnown).toBe(false);
    g.observePanic({ frame: one(c('OFF', broadcast)), at: 100, source: 'panic' }, { kind: 'sent' });
    expect(g.addressInfo(0)?.levelKnown).toBe(true);
  });
  it('the fingerprint covers unlocks in any order, the facts and the shadow', () => {
    const sim = Simulator.bench();
    const g = bare('simulator', sim);
    const h = bare('simulator', Simulator.bench());
    g.unlock('rate', 'ui', true);
    g.unlock('expert', 'ui', true);
    h.unlock('expert', 'ui', true);
    h.unlock('rate', 'ui', true);
    expect(g.fingerprint()).toBe(h.fingerprint());
    tell(g, c('QUERY_MAX_LEVEL', A), reply(200));
    tell(g, c('QUERY_MIN_LEVEL', A), reply(90));
    const f1 = g.fingerprint();
    g.markVerified(0, { max: 200, min: 90, powerOn: 0, systemFailure: 255, linear: false });
    const f2 = g.fingerprint();
    expect(f2).not.toBe(f1);
    new Rig(sim, 200).to('DAPC', 1, 100);
    expect(g.fingerprint()).not.toBe(f2);
  });
});
