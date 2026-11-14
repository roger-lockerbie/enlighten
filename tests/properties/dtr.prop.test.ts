/**
 * P-dtr: for any stream, a command that reads a DTR is sent only when the governor's view of that
 * DTR equals the simulator's.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decode, type Frame } from '../../src/dali/codec.ts';
import { spec } from '../../src/dali/commands.ts';
import { makeBench } from '../harness/bench.ts';
import { play, steps, timeout } from '../harness/gen.ts';

const RUNS = Number(process.env['PROP_RUNS'] ?? 25);

describe('P-dtr', () => {
  it(
    'reads only registers the governor knows, and knows them right',
    async () => {
      await fc.assert(
        fc.asyncProperty(steps({ reset: true }), async (stream) => {
          const b = makeBench();
          await b.ready();
          b.governor.unlock('reset', 'console', true);
          const problems: string[] = [];
          let previous: Frame | undefined;
          b.sink.onSend = (f) => {
            const cmd = decode(f.frame, previous);
            previous = f.frame;
            if (cmd === undefined) return;
            const s = spec(cmd.id);
            if (s.reads.length === 0) return;
            const view = b.governor.dtrView();
            const reached = cmd.address === undefined ? b.sim.all : b.sim.reached(cmd.address);
            for (const r of s.reads) {
              for (const u of reached) {
                const actual = u.gear.snapshot().dtr[r];
                if (view[r] !== actual)
                  problems.push(
                    `${s.label}: DTR${String(r)} governor ${String(view[r])} gear ${u.id} ${String(actual)}`,
                  );
              }
            }
          };
          await play(b, stream);
          expect(problems).toEqual([]);
        }),
        { numRuns: RUNS },
      );
    },
    timeout(RUNS),
  );
});
