import { describe, expect, it } from 'vitest';
import type { Quad } from './polygon.ts';
import { clipPlane, clipPortal, edgeIntegral, factor, illuminance } from './polygon.ts';
import type { V3 } from './vec.ts';

/** A strip along x at the origin, facing +z, `width` across y. */
function strip(length: number, width: number): Quad {
  const h = width / 2;
  const l = length / 2;
  return [
    [-l, -h, 0],
    [l, -h, 0],
    [l, h, 0],
    [-l, h, 0],
  ];
}

const UP: V3 = [0, 0, 1];
const DOWN: V3 = [0, 0, -1];

describe('the edge integral', () => {
  it('matches the form factor from a point to a rectangle above its corner', () => {
    // A plane element looking up at a rectangle a by b at height h, one corner overhead.
    const a = 0.7;
    const b = 1.3;
    const h = 0.9;
    const A = a / h;
    const B = b / h;
    const want =
      (1 / (2 * Math.PI)) *
      ((A / Math.sqrt(1 + A * A)) * Math.atan(B / Math.sqrt(1 + A * A)) +
        (B / Math.sqrt(1 + B * B)) * Math.atan(A / Math.sqrt(1 + B * B)));
    const rect: V3[] = [
      [0, 0, h],
      [a, 0, h],
      [a, b, h],
      [0, b, h],
    ];
    expect(edgeIntegral([0, 0, 0], UP, rect)).toBeCloseTo(want, 12);
    // Winding does not matter.
    expect(edgeIntegral([0, 0, 0], UP, [...rect].reverse())).toBeCloseTo(want, 12);
  });

  it('gives a whole hemisphere a factor of 1', () => {
    const big = 1e4;
    const sky: V3[] = [
      [-big, -big, 1],
      [big, -big, 1],
      [big, big, 1],
      [-big, big, 1],
    ];
    expect(edgeIntegral([0, 0, 0], UP, sky)).toBeCloseTo(1, 3);
  });

  it('gives nothing for fewer than three corners', () => {
    expect(edgeIntegral([0, 0, 0], UP, [])).toBe(0);
    expect(
      edgeIntegral([0, 0, 0], UP, [
        [0, 0, 1],
        [1, 0, 1],
      ]),
    ).toBe(0);
  });
});

describe('the direct term against the strip formula', () => {
  // docs/research/rendering.md section 2: 1,000 lm over 5 m, 75 mm from a plane.
  const fluxPerMetre = 200;
  const d = 0.075;
  const width = 0.002;
  const lamp = strip(400, width);
  const lux = (x: number): number => illuminance([0, x, d], DOWN, lamp, UP, fluxPerMetre / width);

  it('gives the research figures across the plane', () => {
    expect(lux(0)).toBeCloseTo(1333.3, 0);
    expect(lux(0.05)).toBeCloseTo(768, 0);
    expect(lux(0.1)).toBeCloseTo(288, 0);
    expect(lux(0.2)).toBeCloseTo(57.7, 0);
    expect(lux(0.5)).toBeCloseTo(4.4, 1);
    for (const x of [0, 0.03, 0.2, 1]) {
      const want = ((fluxPerMetre / 2) * d * d) / Math.pow(d * d + x * x, 1.5);
      expect(lux(x) / want).toBeCloseTo(1, 3);
    }
  });

  it('returns the flux when integrated across the plane', () => {
    let sum = 0;
    const step = 0.0005;
    for (let x = -30; x < 30; x += step) sum += lux(x + step / 2) * step;
    expect(sum / fluxPerMetre).toBeCloseTo(1, 2);
  });

  it('gives nothing behind the strip or in its plane', () => {
    expect(illuminance([0, 0, -1], UP, lamp, UP, 1)).toBe(0);
    expect(illuminance([0, 5, 0], UP, lamp, UP, 1)).toBe(0);
    expect(illuminance([0, 0, 1], DOWN, [], UP, 1)).toBe(0);
  });
});

describe('clipping', () => {
  const square: V3[] = [
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];

  it('keeps, cuts and removes against a plane', () => {
    expect(clipPlane(square, [0, 0, 0], [0, 0, 1])).toHaveLength(4);
    expect(clipPlane(square, [0, 0, 2], [0, 0, 1])).toHaveLength(0);
    const half = clipPlane(square, [0.5, 0, 0], [1, 0, 0]);
    expect(half).toHaveLength(4);
    expect(Math.min(...half.map((p) => p[0]))).toBeCloseTo(0.5, 12);
  });

  it('cuts a polygon that straddles the surface the point lies on', () => {
    // A wall rising through the floor plane: only the part above the floor counts.
    const wall: V3[] = [
      [1, -1, -1],
      [1, 1, -1],
      [1, 1, 1],
      [1, -1, 1],
    ];
    const above: V3[] = [
      [1, -1, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, -1, 1],
    ];
    expect(factor([0, 0, 0], UP, wall)).toBeCloseTo(edgeIntegral([0, 0, 0], UP, above), 12);
  });

  it('shows through an opening exactly what a straight line allows', () => {
    // A slot from y = 0 to 0.1 in the plane z = 1, and a wide panel behind it at z = 2.
    const portal: Quad = [
      [-5, 0, 1],
      [5, 0, 1],
      [5, 0.1, 1],
      [-5, 0.1, 1],
    ];
    const panel: V3[] = [
      [-5, -3, 2],
      [5, -3, 2],
      [5, 3, 2],
      [-5, 3, 2],
    ];
    const seen = clipPortal(panel, [0, 0, 0], portal);
    // From the origin the slot's edges project to y = 0 and y = 0.2 on the panel.
    expect(Math.min(...seen.map((p) => p[1]))).toBeCloseTo(0, 9);
    expect(Math.max(...seen.map((p) => p[1]))).toBeCloseTo(0.2, 9);
    const band: V3[] = [
      [-5, 0, 2],
      [5, 0, 2],
      [5, 0.2, 2],
      [-5, 0.2, 2],
    ];
    expect(factor([0, 0, 0], UP, panel, [portal])).toBeCloseTo(
      edgeIntegral([0, 0, 0], UP, band),
      6,
    );
  });

  it('hides everything from a point that looks away from the opening', () => {
    const portal: Quad = [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ];
    const panel: V3[] = [
      [10, 10, 2],
      [11, 10, 2],
      [11, 11, 2],
      [10, 11, 2],
    ];
    expect(factor([0.5, 0.5, 0], UP, panel, [portal])).toBe(0);
  });

  it('ignores an edge of the opening the point is in line with', () => {
    const portal: Quad = [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ];
    const panel: V3[] = [
      [0, 0.2, 2],
      [1, 0.2, 2],
      [1, 0.8, 2],
      [0, 0.8, 2],
    ];
    // The point sits on the line of the opening's first edge.
    const seen = clipPortal(panel, [0.5, 0, 1], portal);
    expect(seen.length).toBeGreaterThanOrEqual(3);
  });
});
