/** V-ui: each page in the dark theme at 1440 by 900, after the bench is scanned. */
import { expect, test } from '@playwright/test';
import { goTo, ready, type PageName } from '../app.ts';

const PAGES: PageName[] = [
  'Playground',
  'Devices',
  'Bus monitor',
  'Settings',
  'Scripts',
  'Visualiser',
  'Looks',
  'Sequences',
  'Effects',
];

test('each page matches its baseline', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  for (const name of PAGES) {
    await goTo(page, name);
    if (name === 'Visualiser') {
      await expect(page.getByTestId('solve-status')).toContainText('Bounced light ready', {
        timeout: 60_000,
      });
    }
    // The bus monitor's times and bus use change from run to run, and so does whether the
    // visualiser's light was solved or kept from before.
    const mask =
      name === 'Bus monitor'
        ? [page.getByTestId('monitor'), page.getByTestId('bus-use')]
        : name === 'Visualiser'
          ? [page.getByText(/^Bus \d+%$/), page.getByTestId('solve-status')]
          : [page.getByText(/^Bus \d+%$/)];
    await expect(page).toHaveScreenshot(`${name.toLowerCase().replace(' ', '-')}.png`, {
      mask,
      animations: 'disabled',
    });
  }
});
