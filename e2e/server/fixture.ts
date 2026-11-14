/**
 * Starts `python -m server --demo` for a test, reads the address it prints, and keeps its output, which
 * lists every frame that reached the fake bus (`bus <hex> <command>`).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const PYTHON = resolve(REPO, 'server/.venv/bin/python');

export interface Server {
  readonly url: string;
  readonly lines: string[];
  /** Commands the fake bus saw, by python-dali class name, from `from` on. */
  bus(from?: number): string[];
  /** Type a line into the server's terminal. */
  type(line: string): void;
  waitFor(pred: (lines: string[]) => boolean, ms?: number): Promise<void>;
  /** Wait for the next address the server prints, after pressing Enter. */
  freshUrl(): Promise<string>;
  stop(): Promise<void>;
}

export async function startServer(args: readonly string[] = []): Promise<Server> {
  if (!existsSync(resolve(REPO, 'dist/headers.json'))) throw new Error('Run pnpm build first.');
  const proc: ChildProcessWithoutNullStreams = spawn(PYTHON, ['-m', 'server', '--demo', ...args], {
    cwd: REPO,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
  const lines: string[] = [];
  let partial = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => {
    partial += chunk;
    const parts = partial.split('\n');
    partial = parts.pop() ?? '';
    lines.push(...parts);
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk: string) => {
    lines.push(...chunk.split('\n').map((l) => `stderr: ${l}`));
  });
  let exited = false;
  const exit = new Promise<void>((r) => {
    proc.on('exit', () => {
      exited = true;
      r();
    });
  });
  const waitFor = async (pred: (l: string[]) => boolean, ms = 20_000) => {
    const end = Date.now() + ms;
    while (!pred(lines)) {
      if (Date.now() > end)
        throw new Error(`Timed out. Server output:\n${lines.slice(-30).join('\n')}`);
      if (exited) throw new Error(`The server exited. Output:\n${lines.join('\n')}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const urls = () => lines.filter((l) => l.startsWith('http://127.0.0.1:47821/#t='));
  await waitFor((l) => l.some((x) => x.startsWith('http://127.0.0.1:47821/#t=')));
  const url = urls()[0] ?? '';
  return {
    url,
    lines,
    bus: (from = 0) =>
      lines
        .slice(from)
        .filter((l) => l.startsWith('bus '))
        .map((l) => l.split(' ')[2] ?? ''),
    type: (line) => proc.stdin.write(`${line}\n`),
    waitFor,
    async freshUrl() {
      const before = urls().length;
      proc.stdin.write('\n');
      await waitFor(() => urls().length > before);
      return urls()[before] ?? '';
    },
    async stop() {
      if (!exited) proc.kill('SIGTERM');
      await exit;
    },
  };
}
