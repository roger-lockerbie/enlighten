import {
  DataArrayTexture,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
  DataUtils,
} from 'three';

const EMITTERS = 6;
const LAYERS = 6;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Per pixel: Lambert's edge integral for EMITTERS rectangles, plus LAYERS reads of an array texture.
const fragmentShader = /* glsl */ `
  uniform sampler2DArray responses;
  uniform vec3 weights[${String(LAYERS)}];
  uniform vec3 corners[${String(EMITTERS * 4)}];
  uniform float mode;
  varying vec2 vUv;

  float edge(vec3 a, vec3 b, vec3 n) {
    float c = clamp(dot(a, b), -1.0, 1.0);
    vec3 x = cross(a, b);
    float l = length(x);
    return l > 1e-6 ? acos(c) * dot(x / l, n) : 0.0;
  }

  void main() {
    if (mode > 0.5) {
      gl_FragColor = vec4(0.5, 0.25, 0.125, 1.0);
      return;
    }
    // A point on the floor of a 5 x 1.2 m hallway.
    vec3 p = vec3(vUv.x * 5.0, 0.0, vUv.y * 1.2);
    vec3 n = vec3(0.0, 1.0, 0.0);
    vec3 sum = vec3(0.0);
    for (int e = 0; e < ${String(EMITTERS)}; e++) {
      vec3 v0 = normalize(corners[e * 4] - p);
      vec3 v1 = normalize(corners[e * 4 + 1] - p);
      vec3 v2 = normalize(corners[e * 4 + 2] - p);
      vec3 v3 = normalize(corners[e * 4 + 3] - p);
      float f = edge(v0, v1, n) + edge(v1, v2, n) + edge(v2, v3, n) + edge(v3, v0, n);
      sum += abs(f) * 0.159155 * weights[e];
    }
    for (int l = 0; l < ${String(LAYERS)}; l++) {
      sum += texture(responses, vec3(vUv, float(l))).r * weights[l];
    }
    gl_FragColor = vec4(sum / (1.0 + sum), 1.0);
  }
`;

export interface GlResult {
  ok: boolean;
  renderer: string;
  rawPixel: number[];
  colourSpace: string;
  msPerFrame: number;
  frames: number;
  error?: string;
}

export function runGl(canvas: HTMLCanvasElement): GlResult {
  const result: GlResult = {
    ok: false,
    renderer: '',
    rawPixel: [],
    colourSpace: '',
    msPerFrame: -1,
    frames: 0,
  };
  try {
    const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false });
    renderer.setPixelRatio(1);
    renderer.setSize(1440, 900, false);
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    result.renderer = info
      ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));

    const w = 128;
    const h = 64;
    const data = new Uint16Array(w * h * 4 * LAYERS);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = DataUtils.toHalfFloat(((i / 4) % w) / w);
      data[i + 3] = DataUtils.toHalfFloat(1);
    }
    const tex = new DataArrayTexture(data, w, h, LAYERS);
    tex.format = RGBAFormat;
    tex.type = HalfFloatType;
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.needsUpdate = true;

    const corners: Vector3[] = [];
    for (let e = 0; e < EMITTERS; e++) {
      const y = 0.3 + 0.35 * e;
      const z = e % 2 === 0 ? 0.0 : 1.2;
      corners.push(
        new Vector3(0, y, z),
        new Vector3(5, y, z),
        new Vector3(5, y + 0.012, z),
        new Vector3(0, y + 0.012, z),
      );
    }
    const weights = Array.from({ length: LAYERS }, () => new Vector3(1, 0.8, 0.6));
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        responses: { value: tex },
        weights: { value: weights },
        corners: { value: corners },
        mode: { value: 1 },
      },
    });
    const mesh = new Mesh(new PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false;
    const scene = new Scene();
    scene.add(mesh);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const px = new Uint8Array(4);

    // 1. A custom ShaderMaterial writes its values untouched.
    renderer.render(scene, camera);
    gl.readPixels(10, 10, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    result.rawPixel = Array.from(px);

    // 2. Display P3 drawing buffer, read back.
    try {
      gl.drawingBufferColorSpace = 'display-p3';
    } catch {
      // Left as it was.
    }
    result.colourSpace = gl.drawingBufferColorSpace;

    // 3. Frame time, forcing each frame to finish with a one-pixel read.
    material.uniforms['mode']!.value = 0;
    for (let i = 0; i < 10; i++) {
      renderer.render(scene, camera);
      gl.readPixels(10, 10, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    const frames = 60;
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
      weights[0]!.x = 1 + i / frames;
      renderer.render(scene, camera);
      gl.readPixels(10, 10, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    result.msPerFrame = (performance.now() - start) / frames;
    result.frames = frames;
    result.ok = px[3] === 255;
  } catch (error) {
    result.error = String(error);
  }
  return result;
}
