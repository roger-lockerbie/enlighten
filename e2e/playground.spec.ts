/**
 * E-playground: level, colour temperature, colour, fade, Live and Commit, clamped and refused values
 * shown, the bench preview following the light, and the frames in the bus monitor (SPEC R13).
 */
import { expect, test } from '@playwright/test';
import { enter, field, goTo, noProblems, openApp } from './app.ts';

test('level, with % and arc level linked, reaches the bench and the preview', async ({ page }) => {
  const w = await openApp(page);
  await enter(page, 'level-0-left', '10.1');
  await expect(field(page, 'level-0-right')).toHaveValue('170');
  await expect(page.getByTestId('level-0-feedback')).toContainText('Sent level 170.');
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('10.1%');
  await enter(page, 'level-0-right', '148');
  await expect(field(page, 'level-0-left')).toHaveValue('5.5');
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('5.5%');
  // The slider steps by one arc level from the keyboard, and by ten with Shift.
  const slider = page.getByTestId('level-0').getByRole('slider', { name: 'Level' });
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(field(page, 'level-0-right')).toHaveValue('149');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(field(page, 'level-0-right')).toHaveValue('159');
  // End goes to the ceiling, not to full.
  await page.keyboard.press('End');
  await expect(field(page, 'level-0-right')).toHaveValue('220');
  await expect(page.getByTestId('level-0-feedback')).toContainText('Sent level 220.', {
    timeout: 10_000,
  });
  await noProblems(w);
});

test('colour temperature shows kelvin and mirek, and colour and raw channels reach the bench', async ({
  page,
}) => {
  const w = await openApp(page);
  await enter(page, 'level-0-right', '170');
  await enter(page, 'tc-0-left', '3000');
  await expect(field(page, 'tc-0-right')).toHaveValue('333');
  await expect(page.getByTestId('tc-0-feedback')).toContainText('Sent 333 mirek.');
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('3003 K');

  // RGBWAF: the hue and saturation sliders, then a raw channel.
  const colour = page.getByTestId('colour-1');
  await colour.getByRole('slider', { name: /Saturation/ }).fill('100');
  await expect(page.getByTestId('colour-1-feedback')).toContainText('Sent channels 254 0 0', {
    timeout: 10_000,
  });
  await colour.getByRole('button', { name: 'Raw channels' }).click();
  await colour.getByRole('slider', { name: 'Green' }).fill('100');
  await expect(colour.getByTestId('colour-1-ch1')).toHaveText('100');
  await expect(page.getByTestId('colour-1-feedback')).toContainText('Sent channels 254 100 0', {
    timeout: 10_000,
  });
  await noProblems(w);
});

test('the fade picker sets standard and extended fades and says which the driver uses', async ({
  page,
}) => {
  const w = await openApp(page);
  const fade = page.getByTestId('fade-0');
  await fade.getByRole('combobox').selectOption({ label: '2 s (standard fade time 4)' });
  await expect(page.getByTestId('fade-0-why')).toContainText(
    'The driver uses its standard fade time 4.',
  );
  await expect(page.getByTestId('fade-0-why')).toContainText('A level change takes 2 s.');
  await fade.getByRole('combobox').selectOption({ label: '20 s (larger steps from here)' });
  await expect(page.getByTestId('fade-0-why')).toContainText(
    'The fade time is 0, so the driver uses its extended fade time.',
  );
  await expect(page.getByTestId('fade-0-why')).toContainText('A level change takes 20 s.');
  // A level now fades: the preview says so while it runs.
  await enter(page, 'level-0-right', '200');
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('fading');
  await fade.getByRole('combobox').selectOption({ label: 'No fade' });
  await expect(page.getByTestId('fade-0-why')).toContainText('changes are instant');
  await noProblems(w);
});

test('Commit sends nothing until Apply, then sends colour and level together', async ({ page }) => {
  const w = await openApp(page);
  await page.getByTestId('send-mode').getByRole('button', { name: 'Commit' }).click();
  await enter(page, 'level-0-right', '150');
  await enter(page, 'tc-0-left', '5000');
  await page.waitForTimeout(500);
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('off');
  await page.getByTestId('panel-0').getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('message-0')).toContainText('Applied.');
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('5.8%');
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('5000 K');
  // Enter on a slider applies too.
  await enter(page, 'level-0-right', '160');
  await page.getByTestId('level-0').getByRole('slider', { name: 'Level' }).press('Enter');
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('7.7%');
  // RGBWAF in Commit: the channels and the level go together on Apply.
  const colour = page.getByTestId('colour-1');
  await colour.getByRole('button', { name: 'Raw channels' }).click();
  await colour.getByRole('slider', { name: 'Blue' }).fill('200');
  await enter(page, 'level-1-right', '150');
  await page.waitForTimeout(300);
  await expect(page.getByTestId('tape-1').getByTestId('tape-text')).toContainText('off');
  await page.getByTestId('panel-1').getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('message-1')).toContainText('Applied.');
  await expect(page.getByTestId('tape-1').getByTestId('tape-text')).toContainText('5.8%');
  await noProblems(w);
});

test('a clamped value and a value the rate guard holds back are shown beside the control', async ({
  page,
}) => {
  const w = await openApp(page);
  await enter(page, 'level-0-left', '100');
  await expect(page.getByTestId('level-0-feedback')).toContainText('clamped');
  await expect(page.getByTestId('level-0-feedback')).toContainText('Sent level 220.');
  await expect(page.getByTestId('level-0-feedback')).toContainText('ceiling');
  // Off, then straight back on: a second hard step inside 2 s waits for the rate guard (S3.3).
  await page.waitForTimeout(2500);
  await enter(page, 'level-0-right', '0');
  await expect(page.getByTestId('level-0-feedback')).toContainText('Sent level 0.');
  await enter(page, 'level-0-right', '220');
  await expect(page.getByTestId('level-0-feedback')).toContainText('Waiting: Rate guard');
  await expect(page.getByTestId('level-0-feedback')).toContainText('Sent level 220.', {
    timeout: 10_000,
  });
  // A refusal says what was refused and why.
  await page.getByRole('button', { name: 'Panic' }).click();
  await page.getByTestId('panel-1').getByRole('button', { name: 'Step up one level' }).click();
  await expect(page.getByTestId('message-1')).toContainText('Refused:');
  await noProblems(w);
});

test('the bus monitor lists the frames, decoded, with source, reply and verdict', async ({
  page,
}) => {
  const w = await openApp(page);
  await enter(page, 'level-1-right', '120');
  await expect(page.getByTestId('level-1-feedback')).toContainText('Sent level 120.');
  await goTo(page, 'Bus monitor');
  await expect(page.getByTestId('bus-use')).toContainText('Bus use');
  await page.getByTestId('filter-source').selectOption('ui');
  const row = page.getByTestId('monitor-row').first();
  await expect(row).toContainText('DAPC A1 120');
  await expect(row).toContainText('A1');
  await expect(row).toContainText('sent');
  await page.getByTestId('filter-source').selectOption('any');
  await expect(page.getByTestId('monitor')).toContainText('QUERY MAX LEVEL');
  await expect(page.getByTestId('monitor')).toContainText('reply 220');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByTestId('monitor-empty')).toBeVisible();
  await noProblems(w);
});
