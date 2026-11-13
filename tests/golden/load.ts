/** Read the golden fixtures that `tools/golden/generate.py` writes. Tests read only these files. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Address } from '../../src/dali/address.ts';

const DIR = import.meta.dirname;

function read(name: string): unknown {
  return JSON.parse(readFileSync(join(DIR, name), 'utf8'));
}

export interface FrameFixture {
  pd: string;
  address: Address | null;
  param: number | null;
  frame: [number, number];
  sendTwice: boolean;
  reply: 'none' | 'yesno' | 'value';
  deviceType: 0 | 6 | 8;
  decodesAs: string | null;
}

export interface DecodeRow {
  a: number;
  deviceType: 0 | 6 | 8;
  pd: number[];
}

export interface SeqFrame {
  frame: [number, number];
  sendTwice: boolean;
  expectReply: boolean;
}

export interface SequenceFixture {
  name: string;
  address: number;
  mirek?: number;
  mix?: [number, number, number, number, number, number];
  selector?: number;
  frames: SeqFrame[];
}

export interface HassebFixture {
  send: { pd: string; frame: [number, number]; report: number[] }[];
  sequenceWrap: number[][];
  firmware: { request: number[]; reply: number[]; version: string };
  configure: { enable: number[]; disable: number[] };
  extract: { report: number[]; pd: { kind: string; byte?: number } }[];
}

export interface FakeGear {
  shortAddress: number | null;
  groups: number[];
  deviceTypes: number[];
  randomPreload: number[];
}

export interface FakeFrame {
  pd: string;
  frame: [number, number];
  sendTwice: boolean;
  reply: number | 'none' | 'collision' | null;
}

export interface FakeStream {
  name: string;
  note: string;
  gear: FakeGear[];
  frames: FakeFrame[];
}

export const frames = () => (read('frames.json') as { commands: FrameFixture[] }).commands;
export const decodeSweep = () => read('decode.json') as { names: string[]; rows: DecodeRow[] };
export const sequences = () =>
  (read('sequences.json') as { sequences: SequenceFixture[] }).sequences;
export const hasseb = () => read('hasseb.json') as HassebFixture;
export const fakes = () =>
  read('fakes.json') as { streams: FakeStream[]; knownDifferences: { id: string; what: string }[] };
