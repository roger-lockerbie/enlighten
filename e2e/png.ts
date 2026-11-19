/**
 * A small PNG reader for the e2e tests, so a screenshot's pixels can be checked in Node without a
 * dependency. It reads what Playwright writes: 8 bits a channel, RGB or RGBA, not interlaced.
 */
import { inflateSync } from 'node:zlib';

export interface Image {
  readonly width: number;
  readonly height: number;
  /** Red, green and blue of the pixel at x, y, 0 to 255 each. */
  at(x: number, y: number): [number, number, number];
}

export function readPng(file: Buffer): Image {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((b, i) => file[i] === b)) throw new Error('Not a PNG.');
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('latin1', offset + 4, offset + 8);
    const body = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const colour = body[9];
      const interlace = body[12];
      if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) {
        throw new Error('Unsupported PNG.');
      }
      channels = colour === 2 ? 3 : 4;
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let i = 0; i < stride; i++) {
      const value = raw[y * (stride + 1) + 1 + i] ?? 0;
      const a = i >= channels ? (pixels[y * stride + i - channels] ?? 0) : 0;
      const b = y > 0 ? (pixels[(y - 1) * stride + i] ?? 0) : 0;
      const c = y > 0 && i >= channels ? (pixels[(y - 1) * stride + i - channels] ?? 0) : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + i] = (value + predicted) & 255;
    }
  }
  return {
    width,
    height,
    at(x, y) {
      const i = y * stride + x * channels;
      return [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0];
    },
  };
}

/** How two pictures differ: how many pixels, the box that holds them, and the largest step. */
export interface Difference {
  readonly sizes: string;
  readonly pixels: number;
  readonly box: string;
  readonly worst: number;
  readonly first: string;
}

/**
 * Compare two pictures pixel by pixel. Equal pictures give `pixels: 0`. `corner` leaves out a
 * square of that many pixels at each corner, where a rounded frame shows through a screenshot.
 */
export function difference(a: Image, b: Image, corner = 0): Difference {
  let pixels = 0;
  let worst = 0;
  let first = '';
  let left = Infinity;
  let top = Infinity;
  let right = -1;
  let bottom = -1;
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nearX = x < corner || x >= w - corner;
      const nearY = y < corner || y >= h - corner;
      if (nearX && nearY) continue;
      const p = a.at(x, y);
      const q = b.at(x, y);
      const step = Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
      if (step === 0) continue;
      if (pixels === 0) first = `${String(x)},${String(y)}: ${p.join(' ')} to ${q.join(' ')}`;
      pixels++;
      worst = Math.max(worst, step);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  const size = (i: Image): string => `${String(i.width)} by ${String(i.height)}`;
  return {
    sizes: a.width === b.width && a.height === b.height ? 'same' : `${size(a)} and ${size(b)}`,
    pixels,
    box:
      pixels === 0
        ? 'none'
        : `${String(left)},${String(top)} to ${String(right)},${String(bottom)}`,
    worst,
    first,
  };
}
