import { describe, expect, it } from 'vitest';
import { short } from '../dali/address.ts';
import { csvCell, exportRows, fileName, toCsv, toJson } from './export.ts';
import { planSequence, type Driver, type Plan } from './plan.ts';

const A: Driver = {
  address: 0,
  drive: 'tc',
  groups: 0,
  minArc: 85,
  auto: true,
  arc: 0,
  colour: { kind: 'none' },
};
const made = planSequence(
  {
    name: 'Night',
    steps: [
      { target: short(0), arc: 0, colour: { kind: 'tc', mirek: 370 }, durationMs: 0 },
      { target: short(0), arc: 195, colour: { kind: 'tc', mirek: 370 }, durationMs: 25 * 60_000 },
    ],
  },
  [A],
  220,
);
if (!made.ok) throw new Error(made.reason);
const plan: Plan = made.value;

describe('the export', () => {
  it('has one row for each change: time, address, command, values and fade', () => {
    expect(exportRows(plan)).toEqual([
      {
        time_ms: 0,
        time: '0 s',
        address: 'A0',
        command: 'level and colour temperature',
        values: 'arc 0 (off), 2700 K',
        fade: 'no fade',
      },
      {
        time_ms: 0,
        time: '0 s',
        address: 'A0',
        command: 'level',
        values: 'arc 155 (6.7%)',
        fade: '16 min (extended fade 0x4F)',
      },
      {
        time_ms: 960_000,
        time: '16 min',
        address: 'A0',
        command: 'level',
        values: 'arc 195 (20.0%)',
        fade: '9 min (extended fade 0x48)',
      },
    ]);
  });

  it('writes CSV with a header, quoted where a cell holds a comma, and CRLF line ends', () => {
    expect(toCsv(plan)).toBe(
      [
        'time_ms,time,address,command,values,fade',
        '0,0 s,A0,level and colour temperature,"arc 0 (off), 2700 K",no fade',
        '0,0 s,A0,level,arc 155 (6.7%),16 min (extended fade 0x4F)',
        '960000,16 min,A0,level,arc 195 (20.0%),9 min (extended fade 0x48)',
        '',
      ].join('\r\n'),
    );
  });

  it('keeps a spreadsheet from reading a cell as a formula', () => {
    for (const start of ['=', '+', '-', '@', '\t', '\r'])
      expect(csvCell(`${start}1+1`).replace(/^"/, '')).toMatch(/^'/);
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a "b"')).toBe('"a ""b"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    // A number is a number, negative or not.
    expect(csvCell(-5)).toBe('-5');
  });

  it('writes JSON with a format, a version and the same rows', () => {
    const j = JSON.parse(toJson('Night', 'sequence', plan)) as Record<string, unknown>;
    expect(j['format']).toBe('enlighten-design');
    expect(j['version']).toBe(1);
    expect(j['name']).toBe('Night');
    expect(j['kind']).toBe('sequence');
    expect(j['duration_ms']).toBe(1_500_000);
    expect(j['rows']).toEqual(exportRows(plan));
    expect(j['notes']).toEqual([]);
    expect('repeats_every_ms' in j).toBe(false);
    const e = JSON.parse(toJson('Breathe', 'effect', { ...plan, periodMs: 8000 })) as Record<
      string,
      unknown
    >;
    expect(e['repeats_every_ms']).toBe(8000);
  });

  it('makes a plain file name from any name', () => {
    expect(fileName('Night fade-in', 'csv')).toBe('night-fade-in.csv');
    expect(fileName('../../etc/passwd', 'json')).toBe('etc-passwd.json');
    expect(fileName('  ', 'csv')).toBe('design.csv');
    expect(fileName('x'.repeat(80), 'csv')).toBe(`${'x'.repeat(40)}.csv`);
  });
});
