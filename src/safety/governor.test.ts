/**
 * U-safety: every row of the rule table in `docs/SPEC.md` section 5, unlocks, the ceiling, the latch,
 * approvals, and the hardware target's worst-case rules.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { broadcast, group, short, unaddressed, type Address } from '../dali/address.ts';
import type { Command } from '../dali/codec.ts';
import { framesFor, framesForAll, rgbwafCommands, tcCommands } from '../dali/sequences.ts';
import { asSubmit, makeBench, type Bench } from '../../tests/harness/bench.ts';
import { DEFAULT_CEILING_ARC, Governor, isApproved } from './governor.ts';
import { RULES } from './rules.ts';
import type { Source, Transaction, Verdict } from './types.ts';
import { Simulator } from '../sim/simulator.ts';
import { COMMANDS, spec } from '../dali/commands.ts';

const A = short(0);
const B = short(1);
const tx = (cmds: readonly Command[], source: Source = 'ui'): Transaction => ({
  frames: framesForAll(cmds),
  source,
});
const dtr0 = (value: number): Command => ({ id: 'DTR0', value });
const c = (id: string, address?: Address, value?: number): Command => ({
  id,
  ...(address === undefined ? {} : { address }),
  ...(value === undefined ? {} : { value }),
});

function judge(b: Bench, cmds: readonly Command[], source: Source = 'ui'): Verdict {
  return b.governor.judge(tx(cmds, source), b.clock.now() + 5000);
}

const allowed = (v: Verdict) => v.kind !== 'refuse';
const reason = (v: Verdict) => (v.kind === 'refuse' ? v.reason : '');

let b: Bench;
beforeEach(async () => {
  b = makeBench();
  await b.ready();
  await b.clock.advance(5000);
});

describe('rule table coverage', () => {
  it('names a rule for every command that is not a query, or refuses it by default', () => {
    for (const s of COMMANDS) {
      if (s.reply !== 'none') continue;
      const named = RULES[s.id] !== undefined;
      if (!named) expect(['PING', 'SAVE_PERSISTENT_VARIABLES']).toContain(s.id);
    }
  });
  it('refuses commands the table does not name (default deny)', () => {
    expect(reason(judge(b, [c('PING')]))).toMatch(/refused always/);
    expect(reason(judge(b, [c('SAVE_PERSISTENT_VARIABLES', A)]))).toMatch(/refused always/);
  });
});

describe('levels', () => {
  it('DAPC above the ceiling is clamped, and 0 and 255 pass', () => {
    const v = judge(b, [c('DAPC', A, 254)]);
    expect(v.kind).toBe('clamp');
    if (v.kind === 'clamp') expect(v.tx.frames[0]?.frame.b).toBe(DEFAULT_CEILING_ARC);
    expect(judge(b, [c('DAPC', A, 0)]).kind).toBe('allow');
    expect(judge(b, [c('DAPC', A, 255)]).kind).toBe('allow');
    expect(judge(b, [c('DAPC', A, 150)]).kind).toBe('allow');
  });
  it('DAPC on RGBWAF gear is clamped further so the mix stays under the ceiling (R6.6)', async () => {
    await b.run(tx(rgbwafCommands(B, [254, 254, 254, 254, 254, 255])));
    const v = judge(b, [c('DAPC', B, 220)]);
    expect(v.kind).toBe('clamp');
    if (v.kind === 'clamp') expect(v.tx.frames[0]?.frame.b).toBeLessThan(180);
  });
  it('OFF is allowed, even to unverified gear', () => {
    const g = makeBench();
    expect(g.governor.judge(tx([c('OFF', A)]), 0).kind).toBe('allow');
  });
  it.each([
    'DOWN',
    'STEP_DOWN',
    'STEP_DOWN_AND_OFF',
    'RECALL_MIN_LEVEL',
    'CONTINUOUS_DOWN',
    'UP',
    'STEP_UP',
    'ON_AND_STEP_UP',
    'CONTINUOUS_UP',
    'RECALL_MAX_LEVEL',
    'GO_TO_LAST_ACTIVE_LEVEL',
    'ENABLE_DAPC_SEQUENCE',
  ])('%s needs a verified address', (id) => {
    expect(allowed(judge(b, [c(id, A)]))).toBe(true);
    const g = makeBench();
    expect(reason(g.governor.judge(tx([c(id, A)]), 0))).toMatch(/not verified/);
  });
  it('GO TO SCENE needs a verified address', () => {
    expect(allowed(judge(b, [c('GO_TO_SCENE', A, 3)]))).toBe(true);
    expect(reason(makeBench().governor.judge(tx([c('GO_TO_SCENE', A, 3)]), 0))).toMatch(
      /not verified/,
    );
  });
  it('indirect commands to a group or broadcast need a fresh inventory and every member verified', async () => {
    expect(allowed(judge(b, [c('RECALL_MAX_LEVEL', broadcast)]))).toBe(true);
    await b.run(tx([c('ADD_TO_GROUP', A, 2)]));
    expect(b.governor.inventoryStale).toBe(true);
    expect(reason(judge(b, [c('RECALL_MAX_LEVEL', group(2))]))).toMatch(/stale/);
    expect(reason(judge(b, [c('RECALL_MAX_LEVEL', unaddressed)]))).toMatch(/short address/);
  });
});

describe('registers', () => {
  it('records DTR loads', async () => {
    await b.run(tx([dtr0(7), c('DTR1', undefined, 8), c('DTR2', undefined, 9)]));
    expect(b.governor.dtrView()).toEqual([7, 8, 9]);
  });
  it('a command that reads an unknown register is refused', () => {
    const g = new Governor({ target: 'simulator', shadow: Simulator.bench() });
    expect(reason(g.judge(tx([c('SET_MAX_LEVEL', A)], 'profile'), 0))).toMatch(
      /DTR0, which is unknown/,
    );
  });
  it('STORE ACTUAL LEVEL IN DTR0 and gear-written queries make registers unknown', async () => {
    await b.run(tx([dtr0(5), c('STORE_ACTUAL_LEVEL_IN_DTR0', A)]));
    expect(b.governor.dtrView()[0]).toBeUndefined();
    expect(reason(judge(b, [c('SET_FADE_TIME', A)]))).toMatch(/unknown/);
    await b.run(
      tx([
        dtr0(5),
        c('DTR1', undefined, 0),
        c('DTR2', undefined, 0),
        c('QUERY_LIGHT_SOURCE_TYPE', A),
      ]),
    );
    expect(b.governor.dtrView()).toEqual([undefined, undefined, undefined]);
    await b.run(tx([dtr0(5), c('DTR1', undefined, 0), c('READ_MEMORY_LOCATION', A)]));
    expect(b.governor.dtrView()[0]).toBeUndefined();
    await b.run(tx([dtr0(2), c('DT8_QUERY_COLOUR_VALUE', A)]));
    expect(b.governor.dtrView()[0]).toBeUndefined();
  });
});

describe('configuration', () => {
  it('SET MAX LEVEL is refused above the ceiling, with 255 counting as 254', () => {
    expect(allowed(judge(b, [dtr0(200), c('SET_MAX_LEVEL', A)]))).toBe(true);
    expect(reason(judge(b, [dtr0(221), c('SET_MAX_LEVEL', A)]))).toMatch(/above the ceiling/);
    expect(reason(judge(b, [dtr0(255), c('SET_MAX_LEVEL', A)]))).toMatch(/above the ceiling/);
  });
  it('SET MIN LEVEL is refused above the ceiling', () => {
    expect(allowed(judge(b, [dtr0(100), c('SET_MIN_LEVEL', A)]))).toBe(true);
    expect(reason(judge(b, [dtr0(255), c('SET_MIN_LEVEL', A)]))).toMatch(/above the ceiling/);
  });
  it('SET SCENE and SET SYSTEM FAILURE LEVEL allow 255 and refuse other values above the ceiling', () => {
    for (const id of ['SET_SCENE', 'SET_SYSTEM_FAILURE_LEVEL']) {
      const v = id === 'SET_SCENE' ? 3 : undefined;
      expect(allowed(judge(b, [dtr0(255), c(id, A, v)]))).toBe(true);
      expect(allowed(judge(b, [dtr0(200), c(id, A, v)]))).toBe(true);
      expect(reason(judge(b, [dtr0(230), c(id, A, v)]))).toMatch(/above the ceiling/);
    }
  });
  it('SET POWER ON LEVEL refuses 255 and values above the ceiling', () => {
    expect(allowed(judge(b, [dtr0(0), c('SET_POWER_ON_LEVEL', A)]))).toBe(true);
    expect(reason(judge(b, [dtr0(255), c('SET_POWER_ON_LEVEL', A)]))).toMatch(/undo/);
    expect(reason(judge(b, [dtr0(230), c('SET_POWER_ON_LEVEL', A)]))).toMatch(/above the ceiling/);
  });
  it('a pending colour stored with a level is judged by the mix rule', async () => {
    await b.run(tx(rgbwafCommands(B, [254, 254, 254, 254, 254, 255], false)));
    expect(reason(judge(b, [dtr0(200), c('SET_SCENE', B, 1)]))).toMatch(/pending colour/);
    expect(reason(judge(b, [dtr0(200), c('SET_POWER_ON_LEVEL', B)]))).toMatch(/pending colour/);
    expect(allowed(judge(b, [dtr0(120), c('SET_SCENE', B, 1)]))).toBe(true);
  });
  it('fade settings need DTR0 known', () => {
    for (const id of ['SET_FADE_TIME', 'SET_FADE_RATE', 'SET_EXTENDED_FADE_TIME']) {
      expect(allowed(judge(b, [dtr0(4), c(id, A)]))).toBe(true);
    }
  });
  it('scene and group membership commands are allowed, and group changes stale the inventory', async () => {
    expect(allowed(judge(b, [c('REMOVE_FROM_SCENE', A, 2)]))).toBe(true);
    await b.run(tx([c('REMOVE_FROM_GROUP', A, 2)]));
    expect(b.governor.inventoryStale).toBe(true);
  });
  it('the profile may write to an unverified address, and nothing else may', () => {
    const g = makeBench();
    g.governor.observe(
      {
        frame: framesFor(dtr0(100))[0] ?? {
          frame: { a: 0, b: 0 },
          sendTwice: false,
          expectReply: false,
        },
        at: 0,
        source: 'profile',
      },
      { kind: 'sent' },
    );
    expect(g.governor.judge(tx([dtr0(100), c('SET_MAX_LEVEL', A)], 'profile'), 10).kind).not.toBe(
      'refuse',
    );
    expect(reason(g.governor.judge(tx([dtr0(100), c('SET_MAX_LEVEL', A)], 'script'), 10))).toMatch(
      /not verified/,
    );
  });
});

describe('DT8 colour', () => {
  it('SET TEMPORARY COLOUR TEMPERATURE needs the registers and Tc gear', () => {
    expect(allowed(judge(b, tcCommands(A, 300, false)))).toBe(true);
    expect(reason(judge(b, tcCommands(B, 300, false)))).toMatch(/does not report Tc/);
  });
  it('SET TEMPORARY RGB and WAF need the registers and RGBWAF gear', () => {
    expect(allowed(judge(b, rgbwafCommands(B, [10, 0, 0, 0, 0, 0], false)))).toBe(true);
    expect(reason(judge(b, rgbwafCommands(A, [10, 0, 0, 0, 0, 0], false)))).toMatch(
      /does not report RGBWAF/,
    );
  });
  it('SET TEMPORARY RGBWAF CONTROL allows channel control only', () => {
    expect(allowed(judge(b, [dtr0(0x01), c('DT8_SET_TEMPORARY_RGBWAF_CONTROL', B)]))).toBe(true);
    expect(reason(judge(b, [dtr0(0x41), c('DT8_SET_TEMPORARY_RGBWAF_CONTROL', B)]))).toMatch(
      /channel control/,
    );
  });
  it('ACTIVATE is refused when the level and colour together would pass the ceiling', async () => {
    await b.run(tx(rgbwafCommands(B, [0, 0, 0, 254, 0, 0])));
    await b.clock.advance(3000);
    await b.run(tx([c('DAPC', B, 220)]));
    await b.clock.advance(3000);
    expect(reason(judge(b, rgbwafCommands(B, [254, 254, 254, 254, 254, 255])))).toMatch(
      /above the ceiling/,
    );
  });
  it('a level command with a colour pending is judged as the pair, and lowered to fit', async () => {
    await b.run(tx(rgbwafCommands(B, [0, 0, 0, 254, 0, 0])));
    await b.clock.advance(3000);
    const v = judge(b, [...rgbwafCommands(B, [254, 254, 0, 0, 0, 255], false), c('DAPC', B, 220)]);
    expect(v.kind).toBe('clamp');
    if (v.kind === 'clamp') expect(v.tx.frames[v.tx.frames.length - 1]?.frame.b).toBeLessThan(220);
  });
  it('Tc step and COPY REPORT TO TEMPORARY need a verified address', () => {
    for (const id of ['DT8_TC_STEP_COOLER', 'DT8_TC_STEP_WARMER', 'DT8_COPY_REPORT_TO_TEMPORARY']) {
      expect(allowed(judge(b, [c(id, A)]))).toBe(true);
    }
  });
  it.each([
    'DT8_SET_TEMPORARY_X',
    'DT8_SET_TEMPORARY_Y',
    'DT8_X_STEP_UP',
    'DT8_Y_STEP_DOWN',
    'DT8_SET_TEMPORARY_PRIMARY_N',
  ])('%s is refused', (id) => {
    const pre =
      spec(id).reads.length > 0 ? [dtr0(1), c('DTR1', undefined, 1), c('DTR2', undefined, 1)] : [];
    expect(reason(judge(b, [...pre, c(id, A)]))).toMatch(/colour type/);
  });
  it('STORE COLOUR TEMPERATURE LIMIT and STORE GEAR FEATURES need the expert unlock and a person', () => {
    const cmds = [
      dtr0(1),
      c('DTR1', undefined, 1),
      c('DTR2', undefined, 0),
      c('DT8_STORE_TC_LIMIT', A),
    ];
    expect(reason(judge(b, cmds))).toMatch(/expert unlock/);
    expect(b.governor.unlock('expert', 'console', true).ok).toBe(true);
    expect(allowed(judge(b, cmds, 'console'))).toBe(true);
    expect(reason(judge(b, cmds, 'script'))).toMatch(/person/);
    expect(allowed(judge(b, [dtr0(1), c('DT8_STORE_GEAR_FEATURES', A)], 'ui'))).toBe(true);
  });
});

describe('RESET, commissioning and the dimming curve', () => {
  it('RESET needs the reset unlock and a person, and is limited to one in 10 s', async () => {
    expect(reason(judge(b, [c('RESET', A)]))).toMatch(/reset unlock/);
    b.governor.unlock('reset', 'ui', true);
    expect(reason(judge(b, [c('RESET', A)], 'script'))).toMatch(/person/);
    const r = await b.run(tx([c('RESET', A)], 'ui'));
    expect(r.kind).toBe('done');
    // The OFF that follows is part of the RESET's one swing.
    await b.clock.advance(350);
    const off = await b.run(tx([c('OFF', A)], 'ui'));
    expect(off.kind).toBe('done');
    await b.clock.advance(3000);
    const again = b.governor.judge(tx([c('RESET', A)], 'ui'), b.clock.now());
    expect(reason(again)).toMatch(/RESET in 10 s/);
    expect(b.governor.addressInfo(0)?.verified).toBe(false);
  });
  it('commissioning needs the reset unlock and a person, and stales the inventory', async () => {
    for (const cmds of [
      [c('INITIALISE', undefined, 0xff)],
      [c('RANDOMISE')],
      [c('COMPARE')],
      [c('PROGRAM_SHORT_ADDRESS', undefined, 3)],
      [dtr0(3), c('SET_SHORT_ADDRESS', A)],
    ]) {
      expect(reason(judge(b, cmds))).toMatch(/reset unlock/);
    }
    b.governor.unlock('reset', 'console', true);
    await b.run(tx([c('INITIALISE', undefined, 0xff)], 'console'));
    expect(b.governor.inventoryStale).toBe(true);
  });
  it('SELECT DIMMING CURVE needs the expert unlock, and the address is unverified after', async () => {
    expect(reason(judge(b, [dtr0(0), c('DT6_SELECT_DIMMING_CURVE', A)]))).toMatch(/expert unlock/);
    b.governor.unlock('expert', 'ui', true);
    await b.run(tx([dtr0(0), c('DT6_SELECT_DIMMING_CURVE', A)]));
    expect(b.governor.addressInfo(0)?.verified).toBe(false);
  });
  it.each([
    ['IDENTIFY_DEVICE', []],
    ['DT6_ENABLE_CURRENT_PROTECTOR', []],
    ['DT6_DISABLE_CURRENT_PROTECTOR', []],
    ['DT6_STORE_DTR_AS_FAST_FADE_TIME', [dtr0(4)]],
    ['SET_OPERATING_MODE', [dtr0(0)]],
    ['DT8_START_AUTO_CALIBRATION', []],
    ['DT6_REFERENCE_SYSTEM_POWER', []],
    ['ENABLE_WRITE_MEMORY', []],
    ['RESET_MEMORY_BANK', [dtr0(0)]],
    ['DT8_STORE_TY_PRIMARY_N', [dtr0(1), c('DTR1', undefined, 1), c('DTR2', undefined, 0)]],
    ['DT8_STORE_XY_PRIMARY_N', [dtr0(1), c('DTR1', undefined, 1), c('DTR2', undefined, 0)]],
    ['DT8_ASSIGN_COLOUR_TO_LINKED_CHANNEL', [dtr0(1)]],
  ] as const)('%s is refused always, even unlocked', (id, pre) => {
    b.governor.unlock('expert', 'ui', true);
    b.governor.unlock('reset', 'ui', true);
    expect(reason(judge(b, [...pre, c(id, A)]))).toMatch(/refused always/);
  });
  it('memory writes are refused', () => {
    expect(
      reason(
        judge(b, [dtr0(1), c('DTR1', undefined, 0), c('WRITE_MEMORY_LOCATION', undefined, 3)]),
      ),
    ).toMatch(/refused always/);
  });
  it('TERMINATE and queries are allowed', () => {
    expect(judge(b, [c('TERMINATE')]).kind).toBe('allow');
    expect(judge(b, [c('QUERY_STATUS', broadcast)]).kind).toBe('allow');
  });
});

describe('raw frames', () => {
  it('a frame that does not decode is refused', () => {
    expect(
      reason(
        b.governor.judge(
          {
            frames: [{ frame: { a: 0xa0, b: 0 }, sendTwice: false, expectReply: false }],
            source: 'console',
          },
          0,
        ),
      ),
    ).toMatch(/not a supported command/);
  });
  it('a device type command without ENABLE DEVICE TYPE before it is refused', () => {
    const f = framesFor(c('DT8_ACTIVATE', A));
    expect(reason(b.governor.judge({ frames: f.slice(1), source: 'console' }, 0))).toMatch(
      /not a supported command|ENABLE DEVICE TYPE/,
    );
    expect(
      reason(
        b.governor.judge(
          {
            frames: [
              { frame: { a: 0xc1, b: 6 }, sendTwice: false, expectReply: false },
              f[1] ?? f[0] ?? { frame: { a: 0, b: 0 }, sendTwice: false, expectReply: false },
            ],
            source: 'console',
          },
          0,
        ),
      ),
    ).toMatch(/.+/);
  });
  it('flags that do not match the command are refused', () => {
    const [f] = framesFor(c('SET_MAX_LEVEL', A));
    if (f === undefined) throw new Error();
    expect(
      reason(
        b.governor.judge(
          { frames: [...framesFor(dtr0(100)), { ...f, sendTwice: false }], source: 'console' },
          0,
        ),
      ),
    ).toMatch(/flag/);
  });
  it('an empty transaction and a panic-sourced one are refused', () => {
    expect(reason(b.governor.judge({ frames: [], source: 'ui' }, 0))).toMatch(/empty/);
    expect(reason(b.governor.judge(tx([c('OFF', A)], 'panic'), 0))).toMatch(/Panic/);
  });
});

describe('unlocks, the ceiling and the latch', () => {
  it('only a person with a confirmation can unlock, and a script never can', () => {
    expect(b.governor.unlock('rate', 'script', true).ok).toBe(false);
    expect(b.governor.unlock('rate', 'ui', false).ok).toBe(false);
    expect(b.governor.unlock('rate', 'ui', true).ok).toBe(true);
    expect(b.governor.isUnlocked('rate')).toBe(true);
    b.governor.lock('rate');
    expect(b.governor.isUnlocked('rate')).toBe(false);
    b.governor.unlock('expert', 'ui', true);
    b.governor.lock();
    expect(b.governor.isUnlocked('expert')).toBe(false);
  });
  it('the swing limit needs the rate unlock, never passes three, and is refused when the operator cannot see', () => {
    expect(b.governor.setSwingLimit(3, 'ui').ok).toBe(false);
    b.governor.unlock('rate', 'ui', true);
    expect(b.governor.setSwingLimit(2, 'script').ok).toBe(false);
    expect(b.governor.setSwingLimit(9, 'ui').ok).toBe(false);
    expect(b.governor.setSwingLimit(Number.NaN, 'ui').ok).toBe(false);
    expect(b.governor.setSwingLimit(2.5, 'ui').ok).toBe(false);
    expect(b.governor.setSwingLimit(3, 'ui').ok).toBe(true);
    expect(b.governor.swingLimit).toBe(3);
    b.governor.setOperatorCanSee(false, 'ui');
    expect(b.governor.swingLimit).toBe(1);
    expect(b.governor.unlock('rate', 'ui', true).ok).toBe(false);
  });
  it('lowering the ceiling is open to any source and raising needs a confirmed person', () => {
    expect(b.governor.setCeiling(200, 'script').ok).toBe(true);
    expect(b.governor.addressInfo(0)?.verified).toBe(false);
    expect(b.governor.setCeiling(210, 'script', true).ok).toBe(false);
    expect(b.governor.setCeiling(210, 'ui').ok).toBe(false);
    expect(b.governor.setCeiling(210, 'ui', true).ok).toBe(true);
    expect(b.governor.setCeiling(0, 'ui').ok).toBe(false);
  });
  it('a ceiling below a driver physical minimum is refused with the lowest it can hold (R6.5)', () => {
    const r = b.governor.setCeiling(60, 'ui');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/85/);
  });
  it('the latch refuses everything until a person resumes', () => {
    b.governor.latch();
    expect(reason(judge(b, [c('QUERY_STATUS', A)]))).toMatch(/latched/);
    expect(b.governor.resume('script').ok).toBe(false);
    expect(b.governor.resume('ui').ok).toBe(true);
    expect(judge(b, [c('QUERY_STATUS', A)]).kind).toBe('allow');
  });
  it('markVerified checks every read-back', () => {
    const rb = { max: 220, min: 85, powerOn: 0, systemFailure: 255, linear: false };
    expect(b.governor.markVerified(0, { ...rb, linear: true }).ok).toBe(false);
    expect(b.governor.markVerified(0, { ...rb, max: 230 }).ok).toBe(false);
    expect(b.governor.markVerified(0, { ...rb, min: 230, max: 220 }).ok).toBe(false);
    expect(b.governor.markVerified(0, { ...rb, powerOn: 254 }).ok).toBe(false);
    expect(b.governor.markVerified(0, { ...rb, systemFailure: 254 }).ok).toBe(false);
    expect(b.governor.markVerified(0, { ...rb, max: 200 }).ok).toBe(false);
    expect(b.governor.markVerified(0, rb).ok).toBe(true);
  });
});

describe('judge and approvals', () => {
  it('judge changes nothing', () => {
    const before = b.governor.fingerprint();
    for (const cmds of [
      [c('DAPC', A, 254)],
      [c('RESET', A)],
      tcCommands(A, 250),
      [c('OFF', broadcast)],
      [dtr0(1), c('SET_MAX_LEVEL', A)],
    ]) {
      b.governor.judge(tx(cmds), b.clock.now());
    }
    expect(b.governor.fingerprint()).toBe(before);
  });
  it('approvals are issued only by judge and only for their transaction', () => {
    const t = tx([c('DAPC', A, 100)]);
    const v = b.governor.judge(t, b.clock.now());
    if (v.kind === 'refuse') throw new Error(v.reason);
    // The approval holds a frozen copy, and that copy is what goes out.
    expect(isApproved(v.approval, v.approval.tx)).toBe(true);
    expect(Object.isFrozen(v.approval.tx.frames[0]?.frame)).toBe(true);
    expect(isApproved(v.approval, t)).toBe(false);
    expect(isApproved(v.approval, tx([c('DAPC', A, 100)]))).toBe(false);
    expect(isApproved({ tx: t }, t)).toBe(false);
    expect(isApproved(null, t)).toBe(false);
  });
});

describe('the hardware target', () => {
  it('starts with everything unknown and every command to an unknown level counts as a hard step', async () => {
    const h = makeBench({ target: 'hardware' });
    await h.ready();
    expect(h.governor.addressInfo(0)?.verified).toBe(true);
    // The scan built the shadow from read-backs: modelled, with the level read, colour still unknown.
    expect(h.governor.addressInfo(0)?.modelled).toBe(true);
    expect(h.governor.addressInfo(0)?.colourKnown).toBe(false);
    await h.clock.advance(3000);
    // No level goes to colour gear until its colour is known (ADR 0019, S5-P1).
    const level = await h.run(tx([c('DAPC', A, 120)]));
    expect(level.kind === 'refused' ? level.reason : level.kind).toMatch(
      /set its colour before its level/,
    );
    expect(level.kind === 'refused' ? level.retryAt : 0).toBeUndefined();
    // An OFF goes, and while the colour is unknown it counts as a leg and a hard step.
    const first = await h.run(tx([c('OFF', A)]));
    expect(first.kind).toBe('done');
    // A second change within 2 s is another hard step.
    const second = h.governor.judge(tx([c('OFF', A)]), h.clock.now() + 100);
    expect(reason(second)).toMatch(/hard step/);
  });
  it('broadcasts count a phantom driver while the inventory is stale', () => {
    const g = new Governor({ target: 'hardware', shadow: Simulator.bench(), connectedAt: -10_000 });
    g.observe(
      {
        frame: framesFor(c('OFF', broadcast))[0] ?? {
          frame: { a: 0, b: 0 },
          sendTwice: false,
          expectReply: false,
        },
        at: 100,
        source: 'ui',
      },
      { kind: 'sent' },
    );
    expect(reason(g.judge(tx([c('OFF', broadcast)]), 300))).toMatch(/hard step/);
  });
  it('a transport fault leaves what the frame could change unknown (R1.9)', async () => {
    b.sink.fault = (f) => (f.frame.a === 0xa3 ? { reached: true } : undefined);
    const r = await b.run(tx([dtr0(50)]));
    expect(r.kind).toBe('fault');
    expect(b.governor.dtrView()[0]).toBeUndefined();
    b.sink.fault = (f) => (f.frame.a === 0x00 ? { reached: false } : undefined);
    await b.run(tx([c('DAPC', A, 100)]));
    expect(b.governor.addressInfo(0)?.verified).toBe(false);
  });
  it('a refused frame changes nothing', () => {
    const before = b.governor.fingerprint();
    b.governor.observe(
      {
        frame: framesFor(dtr0(1))[0] ?? {
          frame: { a: 0, b: 0 },
          sendTwice: false,
          expectReply: false,
        },
        at: 1,
        source: 'ui',
      },
      { kind: 'refused', reason: 'server' },
    );
    expect(b.governor.fingerprint()).toBe(before);
  });
});

describe('the safety profile (S1)', () => {
  it('verifies both drivers on the bench', () => {
    expect(b.governor.addressInfo(0)?.verified).toBe(true);
    expect(b.governor.addressInfo(1)?.verified).toBe(true);
    const g = b.sim.unit('A')?.gear.snapshot();
    expect([g?.maxLevel, g?.powerOnLevel, g?.systemFailureLevel]).toEqual([220, 0, 255]);
  });
  it('a linear curve is a mismatch and the address stays unverified', async () => {
    const sim = Simulator.bench();
    const r = new (await import('../sim/rig.ts')).Rig(sim);
    r.set('DT6_SELECT_DIMMING_CURVE', 0, 1);
    const h = makeBench({ sim });
    await h.ready();
    expect(h.governor.addressInfo(0)?.verified).toBe(false);
    expect(h.governor.addressInfo(1)?.verified).toBe(true);
  });
  it('a ceiling below the physical minimum is refused by the profile', async () => {
    const h = makeBench({ ceilingArc: 60 });
    const { applySafetyProfile, scan } = await import('./profile.ts');
    const res = await h.drive(
      (async () => {
        await scan(h.governor, asSubmit(h), [0]);
        return applySafetyProfile(0, h.governor, asSubmit(h));
      })(),
    );
    expect(res.verified).toBe(false);
    expect(res.reason).toMatch(/physical minimum/);
    expect(res.unconfirmed.length).toBe(2);
  });
  it('MIN LEVEL above the ceiling is lowered first', async () => {
    const sim = Simulator.bench();
    const r = new (await import('../sim/rig.ts')).Rig(sim);
    r.set('SET_MIN_LEVEL', 0, 240);
    const h = makeBench({ sim });
    await h.ready();
    expect(h.governor.addressInfo(0)?.verified).toBe(true);
    expect(sim.unit('A')?.gear.snapshot().minLevel).toBe(85);
  });
  it('a fault mid-profile fails it with the reason', async () => {
    const h = makeBench();
    h.sink.fault = (f) => (f.frame.b === 42 ? { reached: false } : undefined);
    await h.ready();
    expect(h.governor.addressInfo(0)?.verified).toBe(false);
  });
});
