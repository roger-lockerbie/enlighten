/**
 * A reference for the light core (docs/research/rendering.md section 6, item 8): a small path
 * tracer that estimates the illuminance at fixed points for a few scenes, and writes them as
 * fixtures. Development only. Tests read the fixtures and never run this.
 *
 * It shares the scene description with the app and nothing else. It has its own boxes, its own ray
 * caster and its own emitter rectangles, and it knows nothing of portals, form factors or the
 * polygon integral, so an error in those shows as a difference.
 *
 * Run with `pnpm reference`. The random numbers are seeded, so the output is the same every time.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Mount, Scene } from '../../src/light/scene.ts';
import { mount } from '../../src/light/scene.ts';

type V = [number, number, number];

interface Box {
  readonly min: V;
  readonly max: V;
  /** Reflectance of each side: -x, +x, -y, +y, -z, +z. */
  readonly rho: readonly number[];
}

interface Lamp {
  /** A rectangle in a plane of constant `axis`, facing `sign` along it. */
  readonly axis: 1 | 2;
  readonly at: number;
  readonly sign: number;
  readonly x0: number;
  readonly x1: number;
  /** The other in-plane axis: z for a lamp facing up or down, y for one facing across. */
  readonly o0: number;
  readonly o1: number;
  readonly exitance: number;
}

interface Model {
  readonly boxes: readonly Box[];
  readonly lamp: Lamp;
}

function model(scene: Scene, index: number): Model {
  const { length: L, width: W, height: H } = scene;
  const r = scene.reflectance;
  const end = scene.endWalls === 'open' ? 0 : r.walls;
  const boxes: Box[] = [
    { min: [0, 0, 0], max: [L, H, W], rho: [end, end, r.floor, r.ceiling, r.walls, r.walls] },
  ];
  const opening = (m: Mount): { y0: number; y1: number } => {
    const y0 = m.kind === 'skirting' ? 0 : m.height;
    return { y0, y1: y0 + m.slotHeight };
  };
  const seen: Mount[] = [];
  for (const m of scene.mounts) {
    if (m.kind === 'channel') continue;
    if (seen.some((s) => s.side === m.side && s.kind === m.kind && s.height === m.height)) continue;
    seen.push(m);
    const { y0, y1 } = opening(m);
    const z0 = m.side === 'left' ? -m.slotDepth : W;
    const z1 = m.side === 'left' ? 0 : W + m.slotDepth;
    const bottom = m.kind === 'skirting' ? r.floor : r.walls;
    boxes.push({
      min: [m.start, y0, z0],
      max: [m.start + m.length, y1, z1],
      rho: [r.walls, r.walls, bottom, r.walls, r.walls, r.walls],
    });
  }
  const m = scene.mounts[index];
  if (m === undefined) throw new Error('No such mount.');
  const zw = m.side === 'left' ? 0 : W;
  const dir = m.side === 'left' ? -1 : 1;
  const half = m.aperture / 2;
  const exitance = 1 / m.aperture;
  let lamp: Lamp;
  if (m.kind === 'channel') {
    lamp = {
      axis: 2,
      at: zw,
      sign: -dir,
      x0: m.start,
      x1: m.start + m.length,
      o0: m.height - half,
      o1: m.height + half,
      exitance,
    };
  } else {
    const { y0, y1 } = opening(m);
    const up = m.kind === 'reveal' && m.facing === 'up';
    const zc = zw + dir * m.setback;
    lamp = {
      axis: 1,
      at: up ? y0 : y1,
      sign: up ? 1 : -1,
      x0: m.start,
      x1: m.start + m.length,
      o0: zc - half,
      o1: zc + half,
      exitance,
    };
  }
  return { boxes, lamp };
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EPS = 1e-7;

function inside(b: Box, p: V): boolean {
  return (
    p[0] >= b.min[0] - EPS &&
    p[0] <= b.max[0] + EPS &&
    p[1] >= b.min[1] - EPS &&
    p[1] <= b.max[1] + EPS &&
    p[2] >= b.min[2] - EPS &&
    p[2] <= b.max[2] + EPS
  );
}

interface Hit {
  readonly point: V;
  readonly normal: V;
  readonly rho: number;
  readonly distance: number;
}

/** Follow a ray through the boxes until it meets a surface. */
function trace(boxes: readonly Box[], origin: V, d: V): Hit | undefined {
  let p: V = [origin[0], origin[1], origin[2]];
  let travelled = 0;
  for (let step = 0; step < 8; step++) {
    const probe: V = [p[0] + d[0] * 1e-6, p[1] + d[1] * 1e-6, p[2] + d[2] * 1e-6];
    const box = boxes.find((b) => inside(b, probe));
    if (box === undefined) return undefined;
    let t = Infinity;
    let side = 0;
    for (let k = 0; k < 3; k++) {
      const dk = d[k] ?? 0;
      if (dk > 0) {
        const tk = ((box.max[k] ?? 0) - (p[k] ?? 0)) / dk;
        if (tk < t) {
          t = tk;
          side = k * 2 + 1;
        }
      } else if (dk < 0) {
        const tk = ((box.min[k] ?? 0) - (p[k] ?? 0)) / dk;
        if (tk < t) {
          t = tk;
          side = k * 2;
        }
      }
    }
    const exit: V = [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
    travelled += t;
    const beyond: V = [exit[0] + d[0] * 1e-6, exit[1] + d[1] * 1e-6, exit[2] + d[2] * 1e-6];
    const next = boxes.find((b) => b !== box && inside(b, beyond) && !inside(b, probe));
    if (next === undefined) {
      const normal: V = [0, 0, 0];
      normal[side >> 1] = side & 1 ? -1 : 1;
      return { point: exit, normal, rho: box.rho[side] ?? 0, distance: travelled };
    }
    p = exit;
  }
  return undefined;
}

function cosineDirection(n: V, rand: () => number): V {
  const u = rand();
  const phi = 2 * Math.PI * rand();
  const r = Math.sqrt(u);
  const a: V = Math.abs(n[0]) > 0.5 ? [0, 1, 0] : [1, 0, 0];
  const t: V = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
  const tl = Math.hypot(t[0], t[1], t[2]);
  const tx: V = [t[0] / tl, t[1] / tl, t[2] / tl];
  const b: V = [
    n[1] * tx[2] - n[2] * tx[1],
    n[2] * tx[0] - n[0] * tx[2],
    n[0] * tx[1] - n[1] * tx[0],
  ];
  const c = Math.sqrt(1 - u);
  const x = r * Math.cos(phi);
  const y = r * Math.sin(phi);
  return [
    tx[0] * x + b[0] * y + n[0] * c,
    tx[1] * x + b[1] * y + n[1] * c,
    tx[2] * x + b[2] * y + n[2] * c,
  ];
}

function lampPoint(l: Lamp, a: number, b: number): V {
  const x = l.x0 + a * (l.x1 - l.x0);
  const o = l.o0 + b * (l.o1 - l.o0);
  return l.axis === 1 ? [x, l.at, o] : [x, o, l.at];
}

function onLamp(l: Lamp, h: Hit): boolean {
  const along = h.point[0];
  const plane = h.point[l.axis];
  const other = h.point[l.axis === 1 ? 2 : 1];
  return (
    Math.abs(plane - l.at) < 1e-6 &&
    h.normal[l.axis] * l.sign > 0.5 &&
    along >= l.x0 &&
    along <= l.x1 &&
    other >= l.o0 &&
    other <= l.o1
  );
}

/** How far a point is from the lamp's centre line, across the hallway's section. */
function lampDistance(l: Lamp, p: V): number {
  const mid = (l.o0 + l.o1) / 2;
  const [dy, dz] = l.axis === 1 ? [p[1] - l.at, p[2] - mid] : [p[1] - mid, p[2] - l.at];
  const dx = p[0] < l.x0 ? l.x0 - p[0] : p[0] > l.x1 ? p[0] - l.x1 : 0;
  return Math.hypot(dx, dy, dz);
}

/** Direct illuminance by sampling the lamp's area, with a shadow ray for each sample. */
function nextEvent(m: Model, p: V, n: V, rand: () => number, samples: number): number {
  const l = m.lamp;
  const area = (l.x1 - l.x0) * (l.o1 - l.o0);
  let sum = 0;
  for (let s = 0; s < samples; s++) {
    const q = lampPoint(l, (s + rand()) / samples, rand());
    const d: V = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const r = Math.hypot(d[0], d[1], d[2]);
    const w: V = [d[0] / r, d[1] / r, d[2] / r];
    const cosP = w[0] * n[0] + w[1] * n[1] + w[2] * n[2];
    const cosL = -w[l.axis] * l.sign;
    if (cosP <= 0 || cosL <= 0) continue;
    const hit = trace(m.boxes, p, w);
    if (hit === undefined || hit.distance < r - 1e-5) continue;
    sum += (l.exitance * area * cosP * cosL) / (Math.PI * r * r);
  }
  return sum / samples;
}

interface Estimate {
  readonly direct: number;
  readonly indirect: number;
  readonly directError: number;
  readonly indirectError: number;
}

/**
 * Illuminance at a point, split into light straight from the lamp and light that has bounced.
 * Near the lamp, direct light is found by the bounce rays that happen to hit it: sampling the
 * lamp's area there would divide by tiny distances. Far from it, the area is sampled.
 */
function estimate(m: Model, p: V, n: V, paths: number, rand: () => number): Estimate {
  const batches = 20;
  const direct: number[] = [];
  const indirect: number[] = [];
  const NEAR = 0.12;
  for (let b = 0; b < batches; b++) {
    let dSum = 0;
    let iSum = 0;
    const count = Math.ceil(paths / batches);
    for (let k = 0; k < count; k++) {
      let q = p;
      let nq = n;
      for (let bounce = 0; bounce < 64; bounce++) {
        const near = lampDistance(m.lamp, q) < NEAR;
        let got = near ? 0 : nextEvent(m, q, nq, rand, bounce === 0 ? 4 : 1);
        const dir = cosineDirection(nq, rand);
        const hit = trace(m.boxes, q, dir);
        if (hit === undefined) {
          if (bounce === 0) dSum += got;
          else iSum += got;
          break;
        }
        if (near && onLamp(m.lamp, hit)) got += m.lamp.exitance;
        if (bounce === 0) dSum += got;
        else iSum += got;
        if (rand() >= hit.rho) break;
        q = hit.point;
        nq = hit.normal;
      }
    }
    direct.push(dSum / count);
    indirect.push(iSum / count);
  }
  const mean = (v: number[]): number => v.reduce((a, c) => a + c, 0) / v.length;
  const stderr = (v: number[]): number => {
    const mu = mean(v);
    return Math.sqrt(v.reduce((a, c) => a + (c - mu) ** 2, 0) / (v.length * (v.length - 1)));
  };
  return {
    direct: mean(direct),
    indirect: mean(indirect),
    directError: stderr(direct),
    indirectError: stderr(indirect),
  };
}

interface Probe {
  readonly name: string;
  readonly point: V;
  readonly normal: V;
}

function roomProbes(scene: Scene): Probe[] {
  const { length: L, width: W, height: H } = scene;
  const x = L / 2;
  const out: Probe[] = [];
  for (const z of [0.03, 0.1, 0.3, 0.6, 0.9, 1.17]) {
    out.push({ name: `floor z=${String(z)}`, point: [x, 0, z], normal: [0, 1, 0] });
    out.push({ name: `ceiling z=${String(z)}`, point: [x, H, z], normal: [0, -1, 0] });
  }
  for (const y of [0.06, 0.2, 0.6, 1.2, 2.0, 2.3, 2.5, 2.65]) {
    out.push({ name: `left y=${String(y)}`, point: [x, y, 0], normal: [0, 0, 1] });
    out.push({ name: `right y=${String(y)}`, point: [x, y, W], normal: [0, 0, -1] });
  }
  out.push({ name: 'end0 centre', point: [0, H / 2, W / 2], normal: [1, 0, 0] });
  out.push({ name: 'floor near end', point: [0.2, 0, W / 2], normal: [0, 1, 0] });
  return out;
}

const base: Omit<Scene, 'mounts'> = {
  length: 5,
  width: 1.2,
  height: 2.7,
  endWalls: 'closed',
  reflectance: { ceiling: 0.9, walls: 0.8, floor: 0.5 },
};

const setups: { readonly name: string; readonly scene: Scene; readonly extra: Probe[] }[] = [
  {
    name: 'channel',
    scene: { ...base, mounts: [mount('m1', 'channel', 'right', 5)] },
    extra: [],
  },
  {
    name: 'skirting',
    scene: { ...base, mounts: [mount('m1', 'skirting', 'left', 5)] },
    extra: [
      { name: 'slot back', point: [2.5, 0.0125, -0.019], normal: [0, 0, 1] },
      { name: 'slot floor', point: [2.5, 0, -0.0095], normal: [0, 1, 0] },
    ],
  },
  {
    name: 'reveal-up',
    scene: { ...base, mounts: [mount('m1', 'reveal', 'right', 5, { height: 2.4, facing: 'up' })] },
    extra: [
      { name: 'reveal back', point: [2.5, 2.415, 1.225], normal: [0, 0, -1] },
      { name: 'reveal top', point: [2.5, 2.43, 1.2125], normal: [0, -1, 0] },
    ],
  },
  {
    name: 'open-ends',
    scene: {
      ...base,
      endWalls: 'open',
      mounts: [mount('m1', 'reveal', 'left', 5, { height: 0.3, facing: 'down' })],
    },
    extra: [],
  },
];

const PATHS = Number(process.env['REFERENCE_PATHS'] ?? 400_000);
const out = setups.map((s, i) => {
  const m = model(s.scene, 0);
  const rand = mulberry(20261118 + i);
  const probes = [...roomProbes(s.scene), ...s.extra].map((p) => {
    const e = estimate(m, p.point, p.normal, PATHS, rand);
    const round = (v: number): number => Number(v.toPrecision(6));
    return {
      name: p.name,
      point: p.point,
      normal: p.normal,
      direct: round(e.direct),
      indirect: round(e.indirect),
      directError: round(e.directError),
      indirectError: round(e.indirectError),
    };
  });
  process.stderr.write(`${s.name}: ${String(probes.length)} points\n`);
  return { name: s.name, scene: s.scene, paths: PATHS, probes };
});
const file = resolve(import.meta.dirname, '..', '..', 'tests', 'golden', 'light', 'reference.json');
writeFileSync(
  file,
  `${JSON.stringify({ note: 'Written by tools/reference/trace.ts. Lux per lm/m of tape.', setups: out }, null, 1)}\n`,
);
process.stderr.write(`Wrote ${file}\n`);
