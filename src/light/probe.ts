/**
 * The probe (ADR 0008): the light at a point on a surface, computed on the CPU from the same data
 * the shader draws, so no pixels are read back. It reports the light as measured, before white
 * balance or gamut mapping.
 */
import { sample } from './atlas.ts';
import { matteLuminance } from './colour/exposure.ts';
import { cct } from './colour/locus.ts';
import type { Vec3, Xy } from './colour/xyz.ts';
import { xyzToXy } from './colour/xyz.ts';
import type { Geometry } from './geometry.ts';
import { facePoint } from './geometry.ts';
import type { Response } from './response.ts';
import { directAt } from './response.ts';

export interface Reading {
  /** Illuminance in lux, and how much of it came straight from a tape. */
  readonly lux: number;
  readonly directLux: number;
  /** Luminance of the surface in cd/m², taking it as matte. */
  readonly luminance: number;
  /** The light arriving, as XYZ with Y in lux. */
  readonly xyz: Vec3;
  /** Its chromaticity, colour temperature and distance from the black-body locus. None in the dark. */
  readonly colour: { readonly xy: Xy; readonly kelvin: number; readonly duv: number } | undefined;
  readonly surface: string;
}

/** Below this the light has no colour worth reporting. */
const DARK_LUX = 1e-6;

/**
 * Read the light at a point on a face. `light` is each mount's output per metre as measured,
 * `Frame.mounts[i].raw` or `shown`, in the scene's order.
 */
export function illuminanceAt(
  g: Geometry,
  response: Response,
  light: readonly Vec3[],
  face: number,
  s: number,
  t: number,
): { readonly xyz: Vec3; readonly direct: number } {
  const f = g.faces[face];
  if (f === undefined) return { xyz: [0, 0, 0], direct: 0 };
  const p = facePoint(f, s, t);
  let x = 0;
  let y = 0;
  let z = 0;
  let direct = 0;
  light.forEach((l, i) => {
    const layer = response.layers[i];
    const d = directAt(g, i, p, f.normal, f.cell);
    const e = d + (layer === undefined ? 0 : sample(response.atlas, layer, f, s, t));
    x += l[0] * e;
    y += l[1] * e;
    z += l[2] * e;
    direct += l[1] * d;
  });
  return { xyz: [x, y, z], direct };
}

export function probe(
  g: Geometry,
  response: Response,
  light: readonly Vec3[],
  face: number,
  s: number,
  t: number,
): Reading {
  const f = g.faces[face];
  const { xyz, direct } = illuminanceAt(g, response, light, face, s, t);
  const lux = xyz[1];
  let colour: Reading['colour'];
  if (lux > DARK_LUX) {
    const xy = xyzToXy(xyz);
    const c = cct(xy);
    colour = { xy, kelvin: c.kelvin, duv: c.duv };
  }
  return {
    lux,
    directLux: direct,
    luminance: matteLuminance(f?.reflectance ?? 0, lux),
    xyz,
    colour,
    surface: f?.name ?? '',
  };
}
