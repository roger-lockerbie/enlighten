/**
 * The hallway renderer: three.js on our own canvas, with our own shaders and colour (ADR 0002,
 * ADR 0008). It draws only when something changes, so a still scene costs nothing and the picture
 * never moves by itself (SPEC S6.3).
 */
import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataArrayTexture,
  DataTexture,
  DataUtils,
  DoubleSide,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Mesh,
  PerspectiveCamera,
  RawShaderMaterial,
  RedFormat,
  RepeatWrapping,
  Scene as ThreeScene,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import type { Camera } from '../../light/camera.ts';
import { whiteLuminance } from '../../light/colour/exposure.ts';
import type { FalseScale } from '../../light/colour/falsecolour.ts';
import { PALETTE } from '../../light/colour/falsecolour.ts';
import type { Display } from '../../light/colour/xyz.ts';
import { displayMatrix } from '../../light/colour/xyz.ts';
import { RIPPLE_SAMPLES } from '../../light/diffuser.ts';
import type { Frame, RippleTable } from '../../light/frame.ts';
import { MAX_CHANNELS } from '../../light/frame.ts';
import type { Face, Geometry } from '../../light/geometry.ts';
import { faceAt, facePoint } from '../../light/geometry.ts';
import type { Atlas } from '../../light/atlas.ts';
import type { Response } from '../../light/response.ts';
import { fragmentShader, vertexShader } from './shaders.ts';

/** How far a tape's lit surface is drawn in front of the face it sits on, in metres. */
const LIFT = 0.0003;
/** How far each face is drawn past its own outer edge, in metres. */
const OVERLAP = 0.002;

const MEASURE_WIDTH = 1440;
const MEASURE_HEIGHT = 900;
const MEASURE_FRAMES = 60;
const MEASURE_WARM_UP = 8;
/** A frame slower than this ends the measurement: the page must stay live. */
const MEASURE_SLOW_MS = 50;
/** How long one tick may draw for before the page gets its turn. */
const MEASURE_TICK_MS = 40;
/** The measurement ends after this long whatever it has. */
const MEASURE_LIMIT_MS = 3000;

export interface Measured {
  /** Milliseconds a frame at 1440 by 900, each frame forced to finish. */
  readonly ms: number;
  readonly frames: number;
  /** True when the measurement was cut short: a frame was too slow, or it ran out of time. */
  readonly stopped: boolean;
  /** What the browser says is drawing. */
  readonly gpu: string;
}

interface Uniforms {
  layers: { value: DataArrayTexture };
  ripple: { value: DataTexture };
  segCorner: { value: Vector3[] };
  segNormal: { value: Vector3[] };
  segInfo: { value: Vector3[] };
  portal: { value: Vector4[] };
  portalZ: { value: number[] };
  mountLight: { value: Vector3[] };
  channelLight: { value: Vector3[] };
  mountSurface: { value: Vector2[] };
  toDisplay: { value: Matrix3 };
  exposure: { value: number };
  falseMode: { value: number };
  falseScale: { value: Vector2 };
  palette: { value: Vector3[] };
}

function halfLayers(layers: readonly Float32Array[], size: number, count: number): Uint16Array {
  const out = new Uint16Array(size * count);
  layers.forEach((layer, i) => {
    if (i >= count) return;
    for (let k = 0; k < size; k++) out[i * size + k] = DataUtils.toHalfFloat(layer[k] ?? 0);
  });
  return out;
}

function arrayTexture(
  data: Uint16Array,
  width: number,
  height: number,
  depth: number,
): DataArrayTexture {
  const t = new DataArrayTexture(data, width, height, depth);
  t.format = RedFormat;
  t.type = HalfFloatType;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/** The parts of a face that are surface, as rectangles in the face's own coordinates. */
function solidCells(f: Face): { s0: number; s1: number; t0: number; t1: number }[] {
  const cut = (values: number[], size: number): number[] =>
    [...new Set([0, size, ...values.filter((v) => v > 0 && v < size)])].sort((a, b) => a - b);
  const ss = cut(
    f.holes.flatMap((h) => [h.s0, h.s1]),
    f.su,
  );
  const ts = cut(
    f.holes.flatMap((h) => [h.t0, h.t1]),
    f.sv,
  );
  const out: { s0: number; s1: number; t0: number; t1: number }[] = [];
  for (let i = 0; i + 1 < ss.length; i++) {
    for (let j = 0; j + 1 < ts.length; j++) {
      const s0 = ss[i] ?? 0;
      const s1 = ss[i + 1] ?? 0;
      const t0 = ts[j] ?? 0;
      const t1 = ts[j + 1] ?? 0;
      const ms = (s0 + s1) / 2;
      const mt = (t0 + t1) / 2;
      if (f.holes.some((h) => ms > h.s0 && ms < h.s1 && mt > h.t0 && mt < h.t1)) continue;
      out.push({ s0, s1, t0, t1 });
    }
  }
  return out;
}

function buildMesh(g: Geometry, atlas: Atlas): BufferGeometry {
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const info: number[] = [];
  const quad = (
    corners: readonly (readonly [number, number, number])[],
    n: readonly [number, number, number],
    uvs: readonly (readonly [number, number])[],
    data: readonly [number, number, number, number],
  ): void => {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const p = corners[k] ?? [0, 0, 0];
      const t = uvs[k] ?? [0, 0];
      position.push(p[0], p[1], p[2]);
      normal.push(n[0], n[1], n[2]);
      uv.push(t[0], t[1]);
      info.push(data[0], data[1], data[2], data[3]);
    }
  };
  const uvOn = (f: Face): ((s: number, t: number) => readonly [number, number]) => {
    const rect = atlas.rects[f.index];
    if (rect === undefined) return () => [0, 0];
    return (s, t) => [
      (rect.x + (s / f.su) * rect.w) / atlas.width,
      (rect.y + (t / f.sv) * rect.h) / atlas.height,
    ];
  };
  for (const f of g.faces) {
    const at = uvOn(f);
    for (const c of solidCells(f)) {
      // Faces meet at edges whose end points differ, which leaves cracks a pixel wide. Each face
      // runs a little past its own outer edge, behind its neighbour, to close them.
      const s0 = c.s0 <= 0 ? -OVERLAP : c.s0;
      const s1 = c.s1 >= f.su ? f.su + OVERLAP : c.s1;
      const t0 = c.t0 <= 0 ? -OVERLAP : c.t0;
      const t1 = c.t1 >= f.sv ? f.sv + OVERLAP : c.t1;
      quad(
        [facePoint(f, s0, t0), facePoint(f, s1, t0), facePoint(f, s1, t1), facePoint(f, s0, t1)],
        f.normal,
        [at(c.s0, c.t0), at(c.s1, c.t0), at(c.s1, c.t1), at(c.s0, c.t1)],
        [f.reflectance, f.cell, 0, 0],
      );
    }
  }
  for (const e of g.emitters) {
    const lifted = e.corners.map(
      (p) =>
        [p[0] + e.normal[0] * LIFT, p[1] + e.normal[1] * LIFT, p[2] + e.normal[2] * LIFT] as const,
    );
    // An unlit tape looks like the surface it sits in, so its strip carries that surface's
    // reflectance and its place in the lightmap.
    const under = e.corners.map((p) => faceAt(g, p, e.normal));
    const face = under[0]?.face;
    const at = face === undefined ? undefined : uvOn(face);
    const uvs = under.map((u) =>
      u === undefined || at === undefined ? ([0, 0] as const) : at(u.s, u.t),
    );
    quad(lifted, e.normal, uvs, [face?.reflectance ?? 0, e.cell, 1, e.mount]);
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  out.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
  out.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  out.setAttribute('info', new BufferAttribute(new Float32Array(info), 4));
  return out;
}

function rippleTexture(tables: readonly RippleTable[], mounts: number): DataTexture {
  const rows = mounts * MAX_CHANNELS;
  const data = new Uint16Array(RIPPLE_SAMPLES * rows);
  tables.forEach((table, m) => {
    table.rows.forEach((row, c) => {
      if (c >= MAX_CHANNELS) return;
      const at = (m * MAX_CHANNELS + c) * RIPPLE_SAMPLES;
      for (let i = 0; i < RIPPLE_SAMPLES; i++) data[at + i] = DataUtils.toHalfFloat(row[i] ?? 0);
    });
  });
  const t = new DataTexture(data, RIPPLE_SAMPLES, rows, RedFormat, HalfFloatType);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = RepeatWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

interface Stage {
  readonly mesh: Mesh<BufferGeometry, RawShaderMaterial>;
  readonly uniforms: Uniforms;
  readonly mounts: number;
}

function aim(camera: PerspectiveCamera, view: Camera): void {
  camera.fov = view.fovY;
  camera.near = view.near;
  camera.far = 60;
  camera.position.set(view.position[0], view.position[1], view.position[2]);
  camera.up.set(0, 1, 0);
  camera.lookAt(view.target[0], view.target[1], view.target[2]);
  camera.updateMatrixWorld();
}

function light(u: Uniforms, frame: Frame): void {
  frame.mounts.forEach((m, i) => {
    u.mountLight.value[i]?.set(m.shown[0], m.shown[1], m.shown[2]);
    for (let c = 0; c < MAX_CHANNELS; c++) {
      const x = m.channels[c] ?? [0, 0, 0];
      u.channelLight.value[i * MAX_CHANNELS + c]?.set(x[0], x[1], x[2]);
    }
  });
}

export class HallwayRenderer {
  /** The colour space the canvas took: Display P3 where the screen has it, sRGB otherwise. */
  readonly display: Display;
  private readonly renderer: WebGLRenderer;
  private readonly gl: WebGL2RenderingContext;
  private readonly world = new ThreeScene();
  private readonly camera = new PerspectiveCamera();
  private mesh: Mesh<BufferGeometry, RawShaderMaterial> | undefined;
  private uniforms: Uniforms | undefined;
  private mounts = 1;
  private width = 1;
  private height = 1;
  private pending = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x000000, 1);
    this.gl = this.renderer.getContext() as WebGL2RenderingContext;
    let display: Display = 'srgb';
    if (matchMedia('(color-gamut: p3)').matches) {
      try {
        this.gl.drawingBufferColorSpace = 'display-p3';
      } catch {
        // Left as it was.
      }
      if (this.gl.drawingBufferColorSpace === 'display-p3') display = 'p3';
    }
    this.display = display;
  }

  /** The surfaces, the tapes and the shader for a scene, with a dark lightmap. */
  private stage(g: Geometry, atlas: Atlas, tables: readonly RippleTable[]): Stage {
    const mounts = Math.max(1, g.emitters.length);
    const segments = g.emitters.flatMap((e) => e.segments.map((s) => ({ e, s })));
    const cells = Math.max(1, g.portals.length);
    const zero = (count: number): Vector3[] => Array.from({ length: count }, () => new Vector3());
    const segCount = Math.max(1, segments.length);
    const segCorner = zero(segCount * 4);
    const segNormal = zero(segCount);
    const segInfo = zero(segCount);
    segments.forEach(({ e, s }, i) => {
      s.corners.forEach((p, k) => segCorner[i * 4 + k]?.set(p[0], p[1], p[2]));
      segNormal[i]?.set(e.normal[0], e.normal[1], e.normal[2]);
      segInfo[i]?.set(e.mount, e.cell, s.weight / e.width);
    });
    const portal = Array.from({ length: cells }, () => new Vector4());
    const portalZ = new Array<number>(cells).fill(0);
    g.portals.forEach((p, i) => {
      portal[i]?.set(p[0][0], p[2][0], p[0][1], p[2][1]);
      portalZ[i] = p[0][2];
    });
    const mountSurface = Array.from({ length: mounts }, () => new Vector2(1, 0));
    g.emitters.forEach((e, i) => {
      const period = tables[i]?.period ?? 1;
      mountSurface[i]?.set(1 / period, 1 / (e.width * Math.PI));
    });
    const m = displayMatrix(this.display);
    const uniforms: Uniforms = {
      layers: {
        value: arrayTexture(
          new Uint16Array(atlas.width * atlas.height * mounts),
          atlas.width,
          atlas.height,
          mounts,
        ),
      },
      ripple: { value: rippleTexture(tables, mounts) },
      segCorner: { value: segCorner },
      segNormal: { value: segNormal },
      segInfo: { value: segInfo },
      portal: { value: portal },
      portalZ: { value: portalZ },
      mountLight: { value: zero(mounts) },
      channelLight: { value: zero(mounts * MAX_CHANNELS) },
      mountSurface: { value: mountSurface },
      toDisplay: { value: new Matrix3().set(...m[0], ...m[1], ...m[2]) },
      exposure: { value: 1 },
      falseMode: { value: 0 },
      falseScale: { value: new Vector2(1, 3) },
      palette: { value: PALETTE.map((c) => new Vector3(c[0], c[1], c[2])) },
    };
    const material = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader,
      fragmentShader: fragmentShader({ segments: segCount, mounts, cells }),
      uniforms: uniforms as unknown as Record<string, { value: unknown }>,
      side: DoubleSide,
    });
    const mesh = new Mesh(buildMesh(g, atlas), material);
    mesh.frustumCulled = false;
    return { mesh, uniforms, mounts };
  }

  /** Show a scene from a view. The lightmap starts dark. */
  setScene(g: Geometry, atlas: Atlas, tables: readonly RippleTable[], view: Camera): void {
    this.disposeScene();
    const { mesh, uniforms, mounts } = this.stage(g, atlas, tables);
    this.world.add(mesh);
    this.mesh = mesh;
    this.uniforms = uniforms;
    this.mounts = mounts;
    aim(this.camera, view);
    this.fit();
    this.schedule();
  }

  /** Put a solved response's layers in the lightmap, or clear it while a solve runs. */
  setResponse(response: Response | undefined): void {
    const u = this.uniforms;
    if (u === undefined) return;
    const old = u.layers.value;
    const { width, height } = old.image;
    const size = width * height;
    const fits = response?.atlas.width === width && response.atlas.height === height;
    // The caller has checked that the response's lightmap is laid out as this scene's is.
    const data = fits
      ? halfLayers(response.layers, size, this.mounts)
      : new Uint16Array(size * this.mounts);
    u.layers.value = arrayTexture(data, width, height, this.mounts);
    old.dispose();
    this.schedule();
  }

  /** What each mount is giving out now. */
  setFrame(frame: Frame): void {
    if (this.uniforms === undefined) return;
    light(this.uniforms, frame);
    this.schedule();
  }

  setExposure(ev: number): void {
    if (this.uniforms === undefined) return;
    this.uniforms.exposure.value = 1 / whiteLuminance(ev);
    this.schedule();
  }

  /** Show false colour on a scale, or the picture. */
  setFalseColour(scale: FalseScale | undefined): void {
    const u = this.uniforms;
    if (u === undefined) return;
    u.falseMode.value = scale === undefined ? 0 : scale.quantity === 'illuminance' ? 1 : 2;
    if (scale !== undefined) u.falseScale.value.set(scale.min, scale.decades);
    this.schedule();
  }

  /** Match the drawing buffer to the canvas's size on the page, in device pixels. */
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.fit();
    this.schedule();
  }

  get aspect(): number {
    return this.width / this.height;
  }

  private fit(): void {
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  /** Draw once, on the next frame. Many changes in one turn cost one draw. */
  private schedule(): void {
    if (this.pending !== 0) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.draw();
    });
  }

  private draw(): void {
    if (this.mesh === undefined) return;
    this.renderer.render(this.world, this.camera);
  }

  /**
   * Time the frame for a scene at 1440 by 900, the size the budget is set for (docs/TEST_PLAN.md,
   * Perf-frame). The scene is drawn off screen, so the picture on the page does not change, and
   * one frame at a time, so the page stays live and Panic is never held up (SPEC S4). A renderer
   * too slow to say anything about the budget is stopped at once.
   */
  measure(
    g: Geometry,
    atlas: Atlas,
    tables: readonly RippleTable[],
    view: Camera,
    frame: Frame,
    ev: number,
  ): Promise<Measured> {
    const gl = this.gl;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = String(gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL));
    const stage = this.stage(g, atlas, tables);
    light(stage.uniforms, frame);
    stage.uniforms.exposure.value = 1 / whiteLuminance(ev);
    const world = new ThreeScene();
    world.add(stage.mesh);
    const camera = new PerspectiveCamera();
    aim(camera, view);
    camera.aspect = MEASURE_WIDTH / MEASURE_HEIGHT;
    camera.updateProjectionMatrix();
    const target = new WebGLRenderTarget(MEASURE_WIDTH, MEASURE_HEIGHT, { samples: 0 }); // Not multisampled: see ADR 0017.;
    const px = new Uint8Array(4);
    const times: number[] = [];
    let drawn = 0;
    const began = performance.now();
    return new Promise((resolve) => {
      const finish = (stopped: boolean): void => {
        this.renderer.setRenderTarget(null);
        target.dispose();
        stage.mesh.geometry.dispose();
        stage.mesh.material.dispose();
        stage.uniforms.layers.value.dispose();
        stage.uniforms.ripple.value.dispose();
        const ms = times.length === 0 ? 0 : times.reduce((a, t) => a + t, 0) / times.length;
        resolve({ ms, frames: times.length, gpu, stopped });
      };
      const step = (): void => {
        // A short run of frames back to back in each tick, then the page gets its turn. Frames
        // drawn one to a tick each start on an idle GPU and read slow.
        const tick = performance.now();
        for (;;) {
          const start = performance.now();
          this.renderer.setRenderTarget(target);
          this.renderer.render(world, camera);
          // Reading a pixel back forces the frame to finish.
          this.renderer.readRenderTargetPixels(target, 0, 0, 1, 1, px);
          this.renderer.setRenderTarget(null);
          const end = performance.now();
          const took = end - start;
          drawn++;
          // The first frames compile the shader and fill caches.
          if (drawn > MEASURE_WARM_UP) times.push(took);
          if (drawn > 1 && took > MEASURE_SLOW_MS) {
            finish(true);
            return;
          }
          if (end - began > MEASURE_LIMIT_MS) {
            finish(true);
            return;
          }
          if (times.length >= MEASURE_FRAMES) {
            finish(false);
            return;
          }
          if (end - tick > MEASURE_TICK_MS) break;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  private disposeScene(): void {
    if (this.mesh !== undefined) {
      this.world.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }
    this.uniforms?.layers.value.dispose();
    this.uniforms?.ripple.value.dispose();
    this.mesh = undefined;
    this.uniforms = undefined;
  }

  dispose(): void {
    if (this.pending !== 0) cancelAnimationFrame(this.pending);
    this.pending = 0;
    this.disposeScene();
    this.renderer.dispose();
  }
}
