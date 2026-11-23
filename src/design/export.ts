/**
 * A design as a table an integrator can read (SPEC R5.6): time, address, command, values and fade,
 * as CSV and as JSON. Nothing here is run or sent.
 *
 * A cell that a spreadsheet would read as a formula (one that starts with =, +, -, @, a tab or a
 * carriage return) gets a single quote in front, so opening the file runs nothing.
 */
import { rowText, type Plan } from './plan.ts';
import { timeText } from './text.ts';

export const EXPORT_FORMAT = 'enlighten-design';
export const EXPORT_VERSION = 1;

export interface ExportRow {
  readonly time_ms: number;
  readonly time: string;
  readonly address: string;
  readonly command: string;
  readonly values: string;
  readonly fade: string;
}

export function exportRows(plan: Plan): ExportRow[] {
  return plan.rows.map((r) => ({
    time_ms: Math.round(r.atMs),
    time: timeText(r.atMs),
    address: `A${String(r.address)}`,
    ...rowText(r),
  }));
}

const FORMULA = /^[=+\-@\t\r]/;

/** One CSV cell: guarded against formulas, and quoted when it holds a comma, a quote or a line end. */
export function csvCell(value: string | number): string {
  const text = typeof value === 'number' ? String(value) : value;
  const safe = typeof value === 'string' && FORMULA.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const COLUMNS = ['time_ms', 'time', 'address', 'command', 'values', 'fade'] as const;

export function toCsv(plan: Plan): string {
  const lines = [COLUMNS.join(',')];
  for (const row of exportRows(plan)) lines.push(COLUMNS.map((c) => csvCell(row[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export function toJson(name: string, kind: 'sequence' | 'effect', plan: Plan): string {
  return JSON.stringify(
    {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      name,
      kind,
      // A repeating effect is one period, which starts again this often.
      ...(plan.periodMs === undefined ? {} : { repeats_every_ms: plan.periodMs }),
      duration_ms: Math.round(plan.endMs),
      notes: plan.notes,
      rows: exportRows(plan),
    },
    null,
    2,
  );
}

/** A file name from a design's name: lower-case letters, digits and hyphens only. */
export function fileName(name: string, extension: 'csv' | 'json'): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug === '' ? 'design' : slug}.${extension}`;
}
