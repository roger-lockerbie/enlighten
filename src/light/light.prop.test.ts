import fc from 'fast-check';
import { describe, it } from 'vitest';
import { channelsToHue, hueToChannels } from './hue.ts';
import { previewColour } from './preview.ts';

const runs = Number(process.env['PROP_RUNS'] ?? 200);

describe('the bench preview colour', () => {
  it('never leaves 0 to 255 for any drive', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -1, max: 2, noNaN: true }), { maxLength: 6 }), (d) => {
        const c = previewColour(d, ['R', 'G', 'B', 'W', 'WW', 'CW']);
        return c.rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);
      }),
      { numRuns: runs },
    );
  });
});

describe('the colour picker field', () => {
  it('round-trips within a channel step', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 359.9, noNaN: true }),
        fc.double({ min: 0.05, max: 1, noNaN: true }),
        (h, s) => {
          const [r, g, b] = hueToChannels(h, s);
          const back = channelsToHue(r, g, b);
          const again = hueToChannels(back.hue, back.saturation);
          return again.every((v, i) => Math.abs(v - ([r, g, b][i] ?? 0)) <= 1);
        },
      ),
      { numRuns: runs },
    );
  });
});
