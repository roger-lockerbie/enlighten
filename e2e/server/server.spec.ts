/**
 * E-server: a page from another origin, a wrong Host, a missing or wrong token, a reused token and a
 * second client are each refused. Closing the tab turns the fake bus off.
 */
import { request as httpRequest, createServer } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { watch } from '../harness.ts';
import { startServer, type Server } from './fixture.ts';

let server: Server | undefined;

test.afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function tryHardware(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Hardware', exact: true }).click();
}

test('refuses a page from another origin', async ({ page }) => {
  server = await startServer();
  // A page on another local port that tries the WebSocket. Its own origin, no token.
  const other = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<!doctype html><script>const ws = new WebSocket("ws://127.0.0.1:47821/bus");' +
        'ws.onopen = () => { document.title = "open"; };' +
        'ws.onerror = () => { document.title = "refused"; };</script>',
    );
  });
  await new Promise<void>((r) => other.listen(47830, '127.0.0.1', r));
  try {
    await page.goto('http://127.0.0.1:47830/');
    await expect(page).toHaveTitle('refused');
    expect(server.lines.some((l) => l.includes('client connected'))).toBe(false);
  } finally {
    await new Promise<void>((r) => other.close(() => { r(); }));
  }
});

test('refuses a wrong Host', async () => {
  server = await startServer();
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: 47821, path: '/', headers: { Host: 'attacker.example:47821' } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end();
  });
  expect(status).toBe(421);
});

test('without a token the page offers the simulator only', async ({ page }) => {
  server = await startServer();
  const w = await watch(page);
  await page.goto('http://127.0.0.1:47821/');
  await expect(page.getByRole('heading', { name: 'Enlighten', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hardware', exact: true })).toBeDisabled();
  await expect(page.getByText('Hardware and Both need the server')).toBeVisible();
  expect(await w.problems()).toEqual([]);
});

test('refuses a wrong token', async ({ page }) => {
  server = await startServer();
  await page.goto(`http://127.0.0.1:47821/#t=${'0'.repeat(64)}`);
  await tryHardware(page);
  await expect(page.getByTestId('connection')).toHaveText('Hardware: disconnected');
  await expect(
    page.getByRole('alert').filter({ hasText: 'refused the session token' }),
  ).toBeVisible();
  expect(server.lines.some((l) => l.includes('client connected'))).toBe(false);
});

test('the URL token works once', async ({ browser }) => {
  server = await startServer();
  const a = await browser.newPage();
  await a.goto(server.url);
  await tryHardware(a);
  await expect(a.getByTestId('connection')).toHaveText(/Hardware: ready/);
  await a.close();
  await server.waitFor((l) => l.some((x) => x.includes('client gone')));
  const b = await browser.newPage();
  await b.goto(server.url);
  await tryHardware(b);
  await expect(b.getByRole('alert').filter({ hasText: 'refused the session token' })).toBeVisible();
  await b.close();
});

test('refuses a second client', async ({ browser }) => {
  server = await startServer();
  const a = await browser.newPage();
  await a.goto(server.url);
  await tryHardware(a);
  await expect(a.getByTestId('connection')).toHaveText(/Hardware: ready/);
  const b = await browser.newPage();
  await b.goto(await server.freshUrl());
  await tryHardware(b);
  await expect(
    b.getByRole('alert').filter({ hasText: 'Another page holds the server' }),
  ).toBeVisible();
  // The first page still holds the bus.
  await expect(a.getByTestId('connection')).toHaveText(/Hardware: ready/);
  await a.close();
  await b.close();
});

test('closing the tab turns the bus off', async ({ page }) => {
  server = await startServer();
  await page.goto(server.url);
  await tryHardware(page);
  await expect(page.getByTestId('connection')).toHaveText(/Hardware: ready/);
  await page.close();
  await server.waitFor((l) => l.some((x) => x.includes('client gone')));
  const gone = server.lines.findIndex((x) => x.includes('client gone'));
  await server.waitFor(() => server?.bus(gone).includes('general.Off') ?? false);
  expect(server.bus(gone).slice(0, 2)).toEqual(['general.Terminate', 'general.Off']);
});
