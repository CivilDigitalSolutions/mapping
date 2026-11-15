// Route replay: the time slider, stepping, play / pause and keyboard use.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openApp, loadSamples, settle } from './helpers.mjs';

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); await server.close(); });

test('replay button is off until there is dated data', async () => {
  const page = await openApp(browser, server);
  assert.ok(await page.locator('#btn-replay').isDisabled());
  await loadSamples(page);
  assert.ok(await page.locator('#btn-replay').isEnabled());
});

test('slider, step buttons, play and pause', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await page.click('#btn-replay');
  assert.ok(await page.locator('#replay-bar').isVisible());
  assert.equal(await page.locator('#rp-time').innerText(), '14 Mar 2024, 08:00:00 GMT');
  assert.equal(await page.locator('#rp-start').innerText(), '14 Mar 2024, 08:00:00 GMT');
  assert.equal(await page.locator('#rp-end').innerText(), '14 Mar 2024, 14:30:00 GMT');

  await page.locator('#rp-slider').fill('380');
  assert.match(await page.locator('#rp-time').innerText(), /10:28:12 GMT/);
  assert.equal(await page.locator('.dm-head').count(), 2, 'both routes are moving');

  await page.click('#rp-next');
  assert.match(await page.locator('#rp-time').innerText(), /10:41:00 GMT/, 'jumps to the next recorded point');
  await page.click('#rp-prev');
  assert.match(await page.locator('#rp-time').innerText(), /10:05:00 GMT/, 'and back to the one before');

  await page.click('#rp-play');
  assert.equal(await page.getAttribute('#rp-play', 'aria-label'), 'Pause');
  const t1 = await page.locator('#rp-time').innerText();
  await page.waitForTimeout(600);
  assert.notEqual(await page.locator('#rp-time').innerText(), t1, 'time moves while playing');
  await page.click('#rp-play');
  assert.equal(await page.getAttribute('#rp-play', 'aria-label'), 'Play');
});

test('keyboard: Space plays and pauses, Escape closes and restores all points', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await page.click('#btn-replay');
  await page.locator('#rp-slider').fill('100');
  await page.focus('#rp-slider');
  await page.keyboard.press('Space');
  assert.equal(await page.getAttribute('#rp-play', 'aria-label'), 'Pause');
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#replay-bar').isHidden());
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-replay');
  await settle(page);
  await page.waitForFunction(() => document.querySelectorAll('.dm-focus').length === 22);
});

test('changing a style or hiding a dataset during replay keeps replay working', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await page.click('#btn-replay');
  await page.locator('#rp-slider').fill('500');
  await page.locator('.ds-card').first().locator('.switch').click();
  assert.equal(await page.locator('.dm-head').count(), 1);
  await page.locator('.ds-card').first().locator('.switch').click();
  await page.locator('.ds-card').nth(1).locator('[data-act=settings]').click();
  await page.click('#set-style .shape-opt:has(input[value=diamond])');
  await page.click('#settings-form button[type=submit]');
  await page.locator('#rp-slider').fill('900');
  assert.match(await page.locator('#rp-time').innerText(), /GMT/);
  assert.deepEqual(page.errors, []);
});
