/**
 * D-fakes: the same command streams through python-dali's fake gear (recorded in fakes.json) and
 * through the simulator, comparing every reply.
 *
 * The simulator is set to match the fake where the DA5-L profile has a setting for an unknown:
 * physical minimum 1, Tc limits 153 to 370 mirek, and the temporary colour kept after ACTIVATE.
 * The four known differences in `docs/research/dali.md` section 15 are listed in the fixture and
 * the streams avoid them.
 */
import { describe, expect, it } from 'vitest';
import { Da5l } from '../../src/sim/gear.ts';
import { da5l } from '../../src/sim/profile.ts';
import { Simulator } from '../../src/sim/simulator.ts';
import { fakes } from './load.ts';

const data = fakes();
const STEP_MS = 100;

describe('D-fakes: replies match python-dali fake gear', () => {
  it('lists the four known differences', () => {
    expect(data.knownDifferences.map((d) => d.id).sort()).toEqual(
      ['colour-value-dtr1', 'min-floor', 'scene-zero', 'set-min-zero'].sort(),
    );
  });

  for (const stream of data.streams) {
    it(`${stream.name}: ${stream.note}`, () => {
      const sim = new Simulator(
        stream.gear.map((g, i) => {
          const dt8 = g.deviceTypes.includes(8);
          const profile = da5l(dt8 ? 'C2' : 'C1', 'tc', {
            physicalMinimum: 1,
            tcLimits: { coolest: 153, warmest: 370, physicalCoolest: 153, physicalWarmest: 370 },
            temporaryClearedAfterActivate: false,
          });
          return {
            id: String(i),
            gear: new Da5l(profile, {
              shortAddress: g.shortAddress,
              groups: g.groups,
              deviceTypesOverride: g.deviceTypes,
              randomPreload: g.randomPreload,
            }),
          };
        }),
      );
      let t = 1000;
      stream.frames.forEach((f, i) => {
        t += STEP_MS;
        const reply = sim.send(
          {
            frame: { a: f.frame[0], b: f.frame[1] },
            sendTwice: f.sendTwice,
            expectReply: f.reply !== null,
          },
          t,
        );
        if (f.reply === null) return;
        const got = reply.kind === 'value' ? reply.byte : reply.kind;
        expect(got, `frame ${String(i)} ${f.pd}`).toEqual(f.reply);
      });
    });
  }
});
