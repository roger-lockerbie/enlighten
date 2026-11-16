/**
 * The hand-written validator (ADR 0009). Everything stored or imported is untrusted. A text is checked
 * for size before it is parsed, then for depth and forbidden keys, then against a schema that refuses
 * unknown keys, checks every number's range, every string's length, every array's length and every
 * enumeration. The result is built as fresh objects and never shares a reference with the input.
 */

/** A workspace file or stored record is at most this many bytes of UTF-8 (SPEC section 8). */
export const MAX_BYTES = 2 * 1024 * 1024;
/** Objects and arrays nest at most this deep. */
export const MAX_DEPTH = 8;
/** Values in one tree at most, so a stored record cannot be huge before the schema's limits apply. */
export const MAX_NODES = 100_000;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

export type Result<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

/** Bytes of UTF-8 a string takes. */
export function utf8Bytes(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * Check a value's shape before any schema: depth, forbidden keys, and only plain JSON types. Walks
 * with its own stack, so a deep value cannot overflow the call stack.
 */
export function checkTree(value: unknown): string | undefined {
  const stack: { v: unknown; depth: number; path: string }[] = [{ v: value, depth: 0, path: '' }];
  let nodes = 0;
  while (stack.length > 0) {
    if (++nodes > MAX_NODES) return `The file has more than ${String(MAX_NODES)} values.`;
    const top = stack.pop();
    if (top === undefined) break;
    const { v, depth, path } = top;
    if (v === null || typeof v === 'string' || typeof v === 'boolean') continue;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return `${where(path)}: not a finite number.`;
      continue;
    }
    if (typeof v !== 'object') return `${where(path)}: not a JSON value.`;
    if (depth >= MAX_DEPTH) return `${where(path)}: nested more than ${String(MAX_DEPTH)} deep.`;
    if (Array.isArray(v)) {
      v.forEach((x, i) => stack.push({ v: x, depth: depth + 1, path: `${path}[${String(i)}]` }));
      continue;
    }
    if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)
      return `${where(path)}: not a plain object.`;
    for (const k of Object.keys(v)) {
      if (FORBIDDEN.has(k)) return `${where(path)}: the key ${k} is not allowed.`;
      stack.push({
        v: (v as Record<string, unknown>)[k],
        depth: depth + 1,
        path: `${path}.${k.slice(0, 40)}`,
      });
    }
  }
  return undefined;
}

const where = (path: string) =>
  path === '' ? 'The file' : path.slice(path.startsWith('.') ? 1 : 0);

/** Size, then parse, then the tree check. Never throws. */
export function parseText(text: string): Result<unknown> {
  if (text.length > MAX_BYTES || utf8Bytes(text) > MAX_BYTES)
    return fail(`The file is larger than ${String(MAX_BYTES / 1024 / 1024)} MB.`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail('The file is not valid JSON.');
  }
  const bad = checkTree(value);
  return bad === undefined ? ok(value) : fail(bad);
}

// -------------------------------------------------------------------------------------------------
// Schemas

/** A schema checks one value and builds a fresh copy of it, or says what is wrong at a path. */
export type Schema<T> = (x: unknown, path: string) => Result<T>;

export const int =
  (min: number, max: number): Schema<number> =>
  (x, path) =>
    typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max
      ? ok(x)
      : fail(`${where(path)}: a whole number from ${String(min)} to ${String(max)}.`);

export const bool: Schema<boolean> = (x, path) =>
  typeof x === 'boolean' ? ok(x) : fail(`${where(path)}: true or false.`);

export const str =
  (max: number): Schema<string> =>
  (x, path) =>
    typeof x === 'string' && x.length <= max
      ? ok(x)
      : fail(`${where(path)}: text of at most ${String(max)} characters.`);

export const oneOf =
  <const T extends string | number | boolean>(...values: readonly T[]): Schema<T> =>
  (x, path) =>
    values.some((v) => v === x)
      ? ok(x as T)
      : fail(`${where(path)}: one of ${values.map((v) => JSON.stringify(v)).join(', ')}.`);

export const arrayOf =
  <T>(item: Schema<T>, max: number): Schema<T[]> =>
  (x, path) => {
    if (!Array.isArray(x)) return fail(`${where(path)}: a list.`);
    if (x.length > max) return fail(`${where(path)}: at most ${String(max)} items.`);
    const out: T[] = [];
    for (let i = 0; i < x.length; i++) {
      const r = item(x[i], `${path}[${String(i)}]`);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return ok(out);
  };

type Fields = Record<string, { readonly schema: Schema<unknown>; readonly optional: boolean }>;
type FromFields<F extends Fields> = {
  -readonly [
    K in keyof F as F[K]['optional'] extends true ? never : K
  ]: F[K]['schema'] extends Schema<infer T> ? T : never;
} & {
  -readonly [
    K in keyof F as F[K]['optional'] extends true ? K : never
  ]?: F[K]['schema'] extends Schema<infer T> ? T : never;
};

export const req = <T>(schema: Schema<T>) => ({ schema, optional: false as const });
export const opt = <T>(schema: Schema<T>) => ({ schema, optional: true as const });

/** A plain object with exactly these keys: unknown keys are refused, optional ones may be absent. */
export const object =
  <F extends Fields>(fields: F): Schema<FromFields<F>> =>
  (x, path) => {
    if (typeof x !== 'object' || x === null || Array.isArray(x))
      return fail(`${where(path)}: an object.`);
    const input = x as Record<string, unknown>;
    for (const k of Object.keys(input))
      if (!Object.prototype.hasOwnProperty.call(fields, k) || FORBIDDEN.has(k))
        return fail(`${where(path)}: unknown key ${JSON.stringify(k.slice(0, 40))}.`);
    const out: Record<string, unknown> = {};
    for (const [k, f] of Object.entries(fields)) {
      if (!Object.prototype.hasOwnProperty.call(input, k)) {
        if (f.optional) continue;
        return fail(`${where(`${path}.${k}`)}: missing.`);
      }
      const r = f.schema(input[k], `${path}.${k}`);
      if (!r.ok) return r;
      out[k] = r.value;
    }
    return ok(out as FromFields<F>);
  };

/** A list whose items are unique by one key. */
export const uniqueBy =
  <T>(list: Schema<T[]>, key: (item: T) => unknown, what: string): Schema<T[]> =>
  (x, path) => {
    const r = list(x, path);
    if (!r.ok) return r;
    const seen = new Set<unknown>();
    for (const item of r.value) {
      const k = key(item);
      if (seen.has(k)) return fail(`${where(path)}: ${what} ${String(k)} appears twice.`);
      seen.add(k);
    }
    return r;
  };

/** Text with a further check, which returns a reason or nothing. */
export const textWith =
  (check: (x: string) => string | undefined): Schema<string> =>
  (x, path) => {
    if (typeof x !== 'string') return fail(`${where(path)}: text.`);
    const bad = check(x);
    return bad === undefined ? ok(x) : fail(`${where(path)}: ${bad}`);
  };

/** A schema from a check function that returns a fresh value or a reason. */
export const custom =
  <T>(check: (x: unknown) => T | string): Schema<T> =>
  (x, path) => {
    const r = check(x);
    return typeof r === 'string' ? fail(`${where(path)}: ${r}`) : ok(r);
  };
