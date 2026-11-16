/**
 * Console lines and scripts for the property tests (P-ceiling and P-rate through the console, ADR
 * 0014): lines a person might type, with values across the whole range, and short scripts of them.
 */
import fc from 'fast-check';

/** Console lines a person might type, with values across the whole range. */
export function consoleLine(o: { panic?: boolean } = {}): fc.Arbitrary<string> {
  const addr = fc.constantFrom('0', '1', 'all', 'g0', '0,1', '0..1');
  const one = fc.constantFrom('0', '1');
  const arc = fc.integer({ min: 0, max: 254 }).map(String);
  const pct = fc.integer({ min: 0, max: 100 }).map((n) => `${String(n)}%`);
  const lvl = fc.oneof(arc, pct);
  const byte = fc.integer({ min: 0, max: 255 }).map((n) => n.toString(16).padStart(2, '0'));
  const k = fc.integer({ min: 1700, max: 8000 }).map((n) => `${String(n)}K`);
  const ch = fc.array(fc.integer({ min: 0, max: 254 }).map(String), { minLength: 3, maxLength: 3 });
  return fc.oneof(
    fc.tuple(addr, lvl).map(([a, v]) => `level ${a} ${v}`),
    fc
      .tuple(one, lvl, fc.constantFrom('0', '300ms', '2s'))
      .map(([a, v, f]) => `level ${a} ${v} fade ${f}`),
    fc.tuple(addr, k, lvl).map(([a, t, v]) => `tc ${a} ${t} ${v}`),
    fc
      .tuple(ch, fc.option(arc))
      .map(([c, w]) => `rgb 1 ${c.join(' ')}${w === null ? '' : ` w ${w}`}`),
    fc.tuple(fc.constantFrom('on', 'off'), addr).map(([c, a]) => `${c} ${a}`),
    fc
      .tuple(addr, fc.integer({ min: 0, max: 15 }))
      .map(([a, n]) => `scene ${a} recall ${String(n)}`),
    fc
      .tuple(one, fc.integer({ min: 0, max: 15 }), fc.option(arc))
      .map(([a, n, v]) => `scene ${a} store ${String(n)}${v === null ? '' : ` ${v}`}`),
    fc.tuple(addr, arc).map(([a, v]) => `dapc ${a} ${v}`),
    arc.map((v) => `dtr0 ${v}`),
    fc
      .tuple(
        fc.constantFrom(
          'set-max-level',
          'set-power-on-level',
          'set-system-failure-level',
          'recall-max-level',
          'store-actual-level-in-dtr0',
          'up',
          'on-and-step-up',
          'go-to-last-active-level',
        ),
        addr,
      )
      .map(([c, a]) => `${c} ${a}`),
    fc.tuple(byte, byte).map(([a, b]) => `raw ${a} ${b}`),
    fc.integer({ min: 30, max: 254 }).map((n) => `cap ${String(n)}`),
    o.panic === false
      ? fc.constantFrom('wait 300ms', 'wait 2s', 'wait 0ms', 'query 0 level')
      : fc.constantFrom('wait 300ms', 'wait 2s', 'panic', 'resume', 'query 0 level'),
  );
}

export type ConsoleStep =
  | { readonly kind: 'line'; readonly text: string }
  | { readonly kind: 'script'; readonly lines: readonly string[] };

export const consoleSteps = (o: { panic?: boolean } = {}): fc.Arbitrary<ConsoleStep[]> => {
  const line = consoleLine(o);
  return fc.array(
    fc.oneof(
      { weight: 3, arbitrary: line.map((text): ConsoleStep => ({ kind: 'line', text })) },
      {
        weight: 1,
        arbitrary: fc
          .tuple(
            fc.array(line, { minLength: 1, maxLength: 8 }),
            fc.option(fc.integer({ min: 2, max: 5 })),
          )
          .map(([lines, n]): ConsoleStep => ({
            kind: 'script',
            lines: n === null ? lines : [`repeat ${String(n)}`, ...lines, 'end'],
          })),
      },
    ),
    { maxLength: 15 },
  );
};
