/** Shared steps for the server tests. */
import { expect, type Page } from '@playwright/test';

/** Go to a page by the rail. */
export async function goTo(page: Page, name: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Pages' })
    .getByRole('button', { name, exact: true })
    .click();
}

/** Connect, answer the operator question, and wait on the Devices page for both drivers. */
export async function connect(page: Page, target: 'Hardware' | 'Both'): Promise<void> {
  await page.getByRole('button', { name: target, exact: true }).click();
  await expect(page.getByTestId('connection')).toHaveText(/Hardware: ready, hasseb firmware 2\.4/);
  await page.getByRole('button', { name: 'Yes, I can see them' }).click();
  await goTo(page, 'Devices');
  // The scan, the safety profile and the reads finish with both drivers verified.
  await expect(page.getByTestId('device-0').getByTestId('profile-status')).toHaveText('verified', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('device-1').getByTestId('profile-status')).toHaveText('verified', {
    timeout: 60_000,
  });
  await expect(page.getByRole('status').filter({ hasText: 'Working' })).toHaveCount(0, {
    timeout: 60_000,
  });
}
