/**
 * The colour picker's hue and saturation field (docs/UI.md section 3), to and from RGBWAF channel
 * levels. Value is held at full: the level control sets brightness.
 */

/** Red, green and blue channel levels (0 to 254) for a hue in degrees and a saturation 0 to 1. */
export function hueToChannels(hue: number, saturation: number): [number, number, number] {
  const h = (((hue % 360) + 360) % 360) / 60;
  const s = Math.min(1, Math.max(0, saturation));
  const c = s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = 1 - s;
  const sector = Math.floor(h);
  const [r, g, b] =
    sector === 0
      ? [c, x, 0]
      : sector === 1
        ? [x, c, 0]
        : sector === 2
          ? [0, c, x]
          : sector === 3
            ? [0, x, c]
            : sector === 4
              ? [x, 0, c]
              : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 254)) as [number, number, number];
}

/** Hue in degrees and saturation 0 to 1 for red, green and blue channel levels. Grey has hue 0. */
export function channelsToHue(
  r: number,
  g: number,
  b: number,
): { hue: number; saturation: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max <= 0) return { hue: 0, saturation: 0 };
  const d = max - min;
  const saturation = d / max;
  if (d === 0) return { hue: 0, saturation: 0 };
  let hue: number;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { hue, saturation };
}
