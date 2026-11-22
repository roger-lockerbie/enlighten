/**
 * E-looks: the library of looks and the drivers' scene slots (SPEC R5.1 to R5.3). A look is made,
 * written to a slot and read back, recalled on its driver and on every driver, marked when it no
 * longer matches, and kept across a reload.
 */
import { expect, test } from '@playwright/test';
import { enter, goTo, noProblems, openApp } from './app.ts';

test('a look is written to a slot, read back, recalled, and marked when it changes', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const w = await openApp(page);
  await goTo(page, 'Looks');
  await expect(page.getByText('No looks yet.')).toBeVisible();

  // A warm look for driver A.
  await page.getByTestId('look-new').click();
  await page.getByTestId('look-name').fill('Warm low');
  await enter(page, 'look-level-right', '150');
  await page.getByTestId('look-kind').getByRole('button', { name: 'Colour temperature' }).click();
  await enter(page, 'look-tc-left', '3000');
  await page.getByTestId('look-save').click();
  await expect(page.getByTestId('looks-message')).toHaveText('Saved "Warm low".');
  await expect(page.getByTestId('looks')).toContainText('3000 K');

  // A second name in use is turned away.
  await page.getByTestId('look-new').click();
  await page.getByTestId('look-name').fill('Warm low');
  await page.getByTestId('look-save').click();
  await expect(page.getByTestId('looks-message')).toHaveText('Another look has that name.');
  await page.getByTestId('look-name').fill('Plain half');
  await enter(page, 'look-level-right', '140');
  await page.getByTestId('look-save').click();

  // Slot 3 of A0: empty, then written and read back, with the colour marked assumed.
  await expect(page.getByTestId('slot-3-state')).toHaveText('Empty.');
  await page.getByTestId('slot-3-look').selectOption('Warm low');
  await page.getByTestId('slot-3-write').click();
  await expect(page.getByTestId('looks-message')).toHaveText(
    '"Warm low" is in slot 3 of A0, read back.',
  );
  await expect(page.getByTestId('slot-3-state')).toContainText('Holds arc 150, read back.');
  await expect(page.getByTestId('slot-3-state')).toContainText('assumed');
  // Nothing lit: a store changes no light.
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('off');

  // Recall on the driver: level and colour arrive together.
  await page.getByTestId('slot-3-recall').click();
  await expect(page.getByTestId('looks-message')).toHaveText('Recalled slot 3 on A0.');
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('3003 K');
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('5.8%');

  // The look changes in the library: the slot no longer matches what the driver holds.
  await page.getByRole('button', { name: 'Edit Warm low' }).click();
  await enter(page, 'look-level-right', '120');
  await page.getByTestId('look-save').click();
  await expect(page.getByTestId('slot-3-state')).toContainText('mismatch');
  await expect(page.getByTestId('slot-3-state')).toContainText('is now arc 120');

  // The other driver takes the plain look in the same slot, and one command recalls both.
  await page.getByTestId('slots-driver').selectOption('1');
  await expect(page.getByTestId('slot-3-state')).toHaveText('Empty.');
  // A look with a colour temperature is not offered to an RGBWAF driver.
  await expect(
    page.getByTestId('slot-3-look').getByRole('option', { name: 'Warm low' }),
  ).toBeDisabled();
  await page.getByTestId('slot-3-look').selectOption('Plain half');
  await page.getByTestId('slot-3-write').click();
  await expect(page.getByTestId('slot-3-state')).toContainText('Holds arc 140, read back.');
  await page.waitForTimeout(2200);
  await page.getByTestId('many-slot').selectOption('3');
  await page.getByTestId('many-recall').click();
  await expect(page.getByTestId('looks-message')).toHaveText('Recalled slot 3 on every driver.');
  await expect(page.getByTestId('tape-1').getByTestId('tape-text')).toContainText('4.4%');

  // Empty the slot on this driver.
  await page.getByTestId('slot-3-remove').click();
  await expect(page.getByTestId('looks-message')).toHaveText('Slot 3 of A1 is empty.');
  await expect(page.getByTestId('slot-3-state')).toHaveText('Empty.');

  // The library and the map stay across a reload. The simulated drivers start afresh, so the map
  // says the driver no longer holds what was written.
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByTestId('verified')).toHaveText('2/2 verified', { timeout: 60_000 });
  await expect(page.getByTestId('looks')).toContainText('Plain half');
  await expect(page.getByTestId('slot-3-state')).toContainText(
    'The driver holds nothing here now.',
    { timeout: 60_000 },
  );
  await noProblems(w);
});
