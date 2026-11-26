/**
 * Taking a picture for the manual (ADR 0024): numbered callouts are placed over named controls,
 * the picture is taken, and the callouts are removed. A callout is a small badge the script adds to
 * the page with DOM calls and style properties, which the app's CSP allows, so the pictures come
 * from the same build a person runs.
 */
import { resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';

export const IMG = resolve(import.meta.dirname, '..', '..', 'docs', 'manual', 'img');

export interface Callout {
  /** The control the badge points at. */
  readonly at: Locator;
  /** Where on the control the badge sits. The default is its top left corner. */
  readonly corner?: 'top-left' | 'top-right' | 'left' | 'bottom-left';
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Mark {
  readonly n: number;
  readonly left: number;
  readonly top: number;
  readonly box: Box;
}

const SIZE = 22;

async function place(callouts: readonly Callout[]): Promise<Mark[]> {
  const marks: Mark[] = [];
  for (const [i, c] of callouts.entries()) {
    await c.at.scrollIntoViewIfNeeded();
    const box = await c.at.boundingBox();
    if (box === null) throw new Error(`Callout ${String(i + 1)} points at nothing on the page.`);
    const corner = c.corner ?? 'top-left';
    const left =
      corner === 'top-right'
        ? box.x + box.width - SIZE / 2
        : corner === 'left'
          ? box.x - SIZE - 4
          : box.x - SIZE / 2;
    const top =
      corner === 'left'
        ? box.y + box.height / 2 - SIZE / 2
        : corner === 'bottom-left'
          ? box.y + box.height - SIZE / 2
          : box.y - SIZE / 2;
    marks.push({ n: i + 1, left: Math.max(2, left), top: Math.max(2, top), box });
  }
  return marks;
}

/** Add the badges and a thin outline round each control. */
async function draw(page: Page, marks: readonly Mark[]): Promise<void> {
  await page.evaluate(
    ({ marks, size }) => {
      for (const m of marks) {
        const ring = document.createElement('div');
        ring.dataset['manualCallout'] = 'ring';
        const r = ring.style;
        r.position = 'fixed';
        r.left = `${String(m.box.x - 3)}px`;
        r.top = `${String(m.box.y - 3)}px`;
        r.width = `${String(m.box.width + 6)}px`;
        r.height = `${String(m.box.height + 6)}px`;
        r.border = '2px solid #f2c94c';
        r.borderRadius = '6px';
        r.boxSizing = 'border-box';
        r.pointerEvents = 'none';
        r.zIndex = '2147483646';
        document.body.append(ring);
        const badge = document.createElement('div');
        badge.dataset['manualCallout'] = 'badge';
        badge.textContent = String(m.n);
        const s = badge.style;
        s.position = 'fixed';
        s.left = `${String(m.left)}px`;
        s.top = `${String(m.top)}px`;
        s.width = `${String(size)}px`;
        s.height = `${String(size)}px`;
        s.borderRadius = '50%';
        s.background = '#f2c94c';
        s.color = '#111';
        s.font = '600 13px Inter, system-ui, sans-serif';
        s.display = 'flex';
        s.alignItems = 'center';
        s.justifyContent = 'center';
        s.pointerEvents = 'none';
        s.zIndex = '2147483647';
        document.body.append(badge);
      }
    },
    { marks: [...marks], size: SIZE },
  );
}

async function clear(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-manual-callout]')) el.remove();
  });
}

/**
 * Take a picture named `name` (without `.png`). `of` crops to one part of the page, with a margin.
 * The mouse is moved away first, so no hover state is in the picture.
 */
export async function shot(
  page: Page,
  name: string,
  o: { callouts?: readonly Callout[]; of?: Locator; margin?: number } = {},
): Promise<void> {
  await page.mouse.move(0, 0);
  const marks = await place(o.callouts ?? []);
  await draw(page, marks);
  let clip: Box | undefined;
  if (o.of !== undefined) {
    const b = await o.of.boundingBox();
    if (b === null) throw new Error(`${name}: the part to picture is not on the page.`);
    const m = o.margin ?? 16;
    const view = page.viewportSize() ?? { width: 1440, height: 900 };
    const x = Math.max(0, Math.floor(b.x - m));
    const y = Math.max(0, Math.floor(b.y - m));
    clip = {
      x,
      y,
      width: Math.min(view.width - x, Math.ceil(b.width + 2 * m)),
      height: Math.min(view.height - y, Math.ceil(b.height + 2 * m)),
    };
  }
  await page.screenshot({
    path: resolve(IMG, `${name}.png`),
    animations: 'disabled',
    ...(clip === undefined ? {} : { clip }),
  });
  await clear(page);
}
