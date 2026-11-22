import { describe, expect, it } from 'vitest';
import { colourText, fadeMs, fadeText, levelText, lookText, timeText } from './text.ts';

describe('a look in words', () => {
  it('says a level as off or a percentage', () => {
    expect(levelText(0)).toBe('off');
    expect(levelText(254)).toBe('100.0%');
    expect(levelText(1)).toBe('0.1%');
  });

  it('says a colour', () => {
    expect(colourText({ kind: 'none' })).toBe('colour unchanged');
    expect(colourText({ kind: 'tc', mirek: 370 })).toBe('2700 K');
    expect(colourText({ kind: 'rgbwaf', channels: [200, 0, 10, 255, 255, 255] })).toBe(
      'R 200, G 0, B 10',
    );
    expect(colourText({ kind: 'rgbwaf', channels: [255, 255, 255, 255, 255, 255] })).toBe(
      'colour unchanged',
    );
  });

  it('says a fade and a time', () => {
    expect(fadeText(undefined)).toBe("the driver's fade");
    expect(fadeText({ kind: 'extended', value: 0 })).toBe('no fade');
    expect(fadeText({ kind: 'standard', value: 4 })).toBe('fade 2 s');
    expect(fadeMs({ kind: 'extended', value: 0x4f })).toBe(16 * 60_000);
    expect(fadeText({ kind: 'extended', value: 0x4f })).toBe('fade 16 min');
    expect(timeText(700)).toBe('0.7 s');
    expect(timeText(45_000)).toBe('45 s');
    expect(timeText(90_000)).toBe('1 min 30 s');
    expect(timeText(59_600)).toBe('1 min');
  });

  it('puts them together', () => {
    expect(
      lookText({
        name: 'Warm',
        arc: 254,
        colour: { kind: 'tc', mirek: 370 },
        fade: { kind: 'standard', value: 4 },
      }),
    ).toBe('100.0%, 2700 K, fade 2 s');
  });
});
