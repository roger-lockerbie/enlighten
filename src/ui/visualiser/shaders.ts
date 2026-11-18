/**
 * The hallway's shaders (ADR 0008). Direct light is computed per pixel: each tape is a rectangle
 * that emits evenly, cut to what the pixel can see through the openings, then integrated in closed
 * form. Indirect light is a sum of lightmap layers. Colour is XYZ until the last step.
 *
 * The clipping and the edge integral repeat `src/light/polygon.ts`, and an e2e test checks the
 * pixels against it. The tone curve and the transfer curve repeat `src/light/colour`.
 */
import { SHOULDER } from '../../light/colour/exposure.ts';
import { PALETTE } from '../../light/colour/falsecolour.ts';
import { MAX_CHANNELS } from '../../light/frame.ts';

export const vertexShader = /* glsl */ `
precision highp float;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
in vec3 position;
in vec3 normal;
in vec2 uv;
in vec4 info;
out vec3 vPoint;
out vec2 vUv;
flat out vec3 vNormal;
flat out vec4 vInfo;
void main() {
  vPoint = position;
  vUv = uv;
  vNormal = normal;
  vInfo = info;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

export interface ShaderCounts {
  /** Tape pieces, at least 1. */
  readonly segments: number;
  /** Mounts, at least 1. */
  readonly mounts: number;
  /** Openings behind the walls, at least 1. */
  readonly cells: number;
}

/**
 * The fragment shader for a scene with these counts. Vertex `info` is reflectance, the surface's
 * cell, 1 for a tape's own lit surface, and that tape's mount.
 */
export function fragmentShader(c: ShaderCounts): string {
  const n = (v: number): string => String(Math.max(1, Math.floor(v)));
  return /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2DArray;

#define SEGMENTS ${n(c.segments)}
#define MOUNTS ${n(c.mounts)}
#define CELLS ${n(c.cells)}
#define CHANNELS ${n(MAX_CHANNELS)}
#define STOPS ${n(PALETTE.length)}
#define MAXV 13

const float PI = 3.14159265358979;
const float SHOULDER = ${SHOULDER.toFixed(4)};

uniform sampler2DArray layers;
uniform sampler2D ripple;
// Four corners for each piece of tape, the way it faces, and (mount, cell, weight over width).
uniform vec3 segCorner[SEGMENTS * 4];
uniform vec3 segNormal[SEGMENTS];
uniform vec3 segInfo[SEGMENTS];
// Each opening: x from, x to, y from, y to, and its wall's z.
uniform vec4 portal[CELLS];
uniform float portalZ[CELLS];
// What each mount gives out per metre as the display will show it, XYZ with Y in lumens.
uniform vec3 mountLight[MOUNTS];
uniform vec3 channelLight[MOUNTS * CHANNELS];
// Per mount: repeats of its pattern per metre, and 1 over (width times pi).
uniform vec2 mountSurface[MOUNTS];
uniform mat3 toDisplay;
// 1 over the luminance that shows as white.
uniform float exposure;
// 0 is the picture, 1 is false colour by illuminance, 2 by luminance.
uniform int falseMode;
// The bottom of the scale and its decades.
uniform vec2 falseScale;
uniform vec3 palette[STOPS];

in vec3 vPoint;
in vec2 vUv;
flat in vec3 vNormal;
flat in vec4 vInfo;
out vec4 outColour;

// The polygon being cut, shared by the steps below so it is never copied between them.
vec3 poly[MAXV];
int count;

// Keep the side of a plane where dot(m, x - q) >= 0. Most planes cut nothing, and those cost
// only the distances.
void clipPlane(vec3 q, vec3 m) {
  float d[MAXV];
  bool inside = false;
  bool outside = false;
  for (int i = 0; i < count; i++) {
    d[i] = dot(m, poly[i] - q);
    if (d[i] >= 0.0) inside = true; else outside = true;
  }
  if (!outside) return;
  if (!inside) { count = 0; return; }
  vec3 kept[MAXV];
  int k = 0;
  for (int i = 0; i < count; i++) {
    int j = i + 1 == count ? 0 : i + 1;
    if (d[i] >= 0.0 && k < MAXV) kept[k++] = poly[i];
    if ((d[i] >= 0.0) != (d[j] >= 0.0) && k < MAXV) {
      kept[k++] = poly[i] + (d[i] / (d[i] - d[j])) * (poly[j] - poly[i]);
    }
  }
  for (int i = 0; i < k; i++) poly[i] = kept[i];
  count = k;
}

// Keep what the point can see through an opening.
void clipPortal(vec3 p, int cell) {
  vec4 r = portal[cell - 1];
  float z = portalZ[cell - 1];
  vec3 corner[4];
  corner[0] = vec3(r.x, r.z, z);
  corner[1] = vec3(r.y, r.z, z);
  corner[2] = vec3(r.y, r.w, z);
  corner[3] = vec3(r.x, r.w, z);
  vec3 toCentre = 0.5 * (corner[0] + corner[2]) - p;
  for (int k = 0; k < 4; k++) {
    if (count < 3) { count = 0; return; }
    vec3 m = cross(corner[k] - p, corner[k == 3 ? 0 : k + 1] - p);
    if (dot(m, m) < 1e-24) continue;
    if (dot(m, toCentre) < 0.0) m = -m;
    clipPlane(p, m);
  }
}

// Lambert's edge integral: the form factor from a point to the polygon, which it sees in full.
float edgeIntegral(vec3 p, vec3 n) {
  float sum = 0.0;
  vec3 a = poly[count - 1] - p;
  for (int i = 0; i < count; i++) {
    vec3 b = poly[i] - p;
    vec3 c = cross(a, b);
    float cl = length(c);
    if (cl > 1e-12) sum += atan(cl, dot(a, b)) * dot(c, n) / cl;
    a = b;
  }
  return abs(sum) / (2.0 * PI);
}

vec3 encode(vec3 v) {
  vec3 x = clamp(v, 0.0, 1.0);
  return mix(12.92 * x, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), x));
}

void main() {
  int cell = int(vInfo.y + 0.5);
  // Illuminance on the surface, and its luminance, as XYZ.
  vec3 lux = vec3(0.0);
  vec3 luminance = vec3(0.0);
  if (vInfo.z < 0.5) {
    for (int s = 0; s < SEGMENTS; s++) {
      vec3 facing = segNormal[s];
      // Behind the tape, or in its plane: it gives nothing this way.
      if (dot(facing, vPoint - segCorner[s * 4]) <= 1e-6) continue;
      for (int k = 0; k < 4; k++) poly[k] = segCorner[s * 4 + k];
      count = 4;
      clipPlane(vPoint, vNormal);
      int from = int(segInfo[s].y + 0.5);
      if (from != cell) {
        if (from > 0 && count >= 3) clipPortal(vPoint, from);
        if (cell > 0 && count >= 3) clipPortal(vPoint, cell);
      }
      if (count < 3) continue;
      lux += edgeIntegral(vPoint, vNormal) * segInfo[s].z * mountLight[int(segInfo[s].x + 0.5)];
    }
    for (int m = 0; m < MOUNTS; m++) {
      lux += texture(layers, vec3(vUv, float(m))).r * mountLight[m];
    }
    luminance = lux * (vInfo.x / PI);
  } else {
    // A tape's own lit surface, with its dots.
    int m = int(vInfo.w + 0.5);
    vec3 light = vec3(0.0);
    float along = vPoint.x * mountSurface[m].x;
    for (int c = 0; c < CHANNELS; c++) {
      float row = (float(m * CHANNELS + c) + 0.5) / float(MOUNTS * CHANNELS);
      light += channelLight[m * CHANNELS + c] * texture(ripple, vec2(along, row)).r;
    }
    luminance = light * mountSurface[m].y;
    lux = luminance * PI;
  }

  if (falseMode != 0) {
    float value = falseMode == 1 ? lux.y : luminance.y;
    float t = value > 0.0 ? clamp(log(value / falseScale.x) / (2.302585093 * falseScale.y), 0.0, 1.0) : 0.0;
    float x = t * float(STOPS - 1);
    int i = min(STOPS - 2, int(floor(x)));
    outColour = vec4(mix(palette[i], palette[i + 1], x - float(i)), 1.0);
    return;
  }

  vec3 rgb = max(toDisplay * (luminance * exposure), 0.0);
  float peak = max(rgb.r, max(rgb.g, rgb.b));
  if (peak > SHOULDER) {
    float room = 1.0 - SHOULDER;
    rgb *= (SHOULDER + room * (1.0 - exp(-(peak - SHOULDER) / room))) / peak;
  }
  outColour = vec4(encode(rgb), 1.0);
}
`;
}
