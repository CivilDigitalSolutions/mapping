// The map and the Datasets panel: markers, popups, keyboard access, styles,
// colour by value, show/hide, removing with Undo, and data surviving a reload.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openApp, loadSamples, settle, cardCount, chooseFile, finishImport, writeTemp, fleetCsv, waitForText } from './helpers.mjs';

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); await server.close(); });

async function centreOf(locator) {
  const b = await locator.boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
}

test('sample data draws one canvas per dataset with a keyboard target per marker', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  assert.equal(await page.locator('.dm-point-canvas').count(), 3);
  await page.waitForFunction(() => document.querySelectorAll('.dm-focus').length === 22);
  assert.match(await page.getAttribute('#map', 'aria-label'), /Press Tab to move between markers/);
  assert.deepEqual(page.errors, []);
});

test('clicking a marker opens its details; Previous / Next step through the route', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await page.waitForSelector('.dm-focus');
  const [x, y] = await centreOf(page.locator('.dm-focus').first());
  await page.mouse.move(x, y);
  await page.waitForSelector('.dm-hover-tip');
  assert.match(await page.locator('.dm-hover-tip').innerText(), /Vehicle 1.*VAN-01/);
  await page.mouse.click(x, y);
  await page.waitForSelector('.pop-sub');
  assert.match(await page.locator('.pop-sub').innerText(), /1 of 10 by time/);
  assert.match(await page.locator('.pop-dl').innerText(), /14 Mar 2024, 08:00:00 GMT/);
  await page.click('.pop-nav button:last-child');
  await page.waitForFunction(() => /2 of 10/.test(document.querySelector('.pop-sub')?.textContent || ''));
});

test('keyboard: Tab to a marker, Enter opens it, Escape returns to the marker', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await page.waitForSelector('.dm-focus');
  await page.locator('.dm-focus').nth(2).focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.pop-title');
  await page.waitForFunction(() => !!document.activeElement.closest('.leaflet-popup'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement.classList.contains('dm-focus'));
});

test('style changes: shape, colour by speed with a scale on the card', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await page.locator('.ds-card').first().locator('[data-act=settings]').click();
  await page.click('#set-style .shape-opt:has(input[value=star])');
  const options = await page.locator('#set-colourby option').allInnerTexts();
  assert.ok(options.some((o) => /Speed/.test(o)) && options.some((o) => /Column: Speed \(km\/h\)/.test(o)));
  await page.selectOption('#set-colourby', 'speed');
  await page.click('#settings-form button[type=submit]');
  await settle(page);
  await waitForText(page.locator('.ds-card').first().locator('.ds-scale'), /Speed \(mph\)/);
  assert.match(await page.locator('.ds-card').first().locator('.ds-icon').innerHTML(), /19\.5 11\.8/, 'star icon on the card');
});

test('colouring by a column and by time, on a split fleet file', async () => {
  const page = await openApp(browser, server);
  await chooseFile(page, writeTemp('fleet.csv', fleetCsv()));
  await page.selectOption('#imp-colourby', 'col:Recorded speed (mph)');
  await finishImport(page, 3);
  await page.waitForFunction(() => document.querySelectorAll('.ds-scale').length === 3);
  await waitForText(page.locator('.ds-scale').first(), /Recorded speed \(mph\)\s+6\s+34/);
  await page.locator('.ds-card').nth(1).locator('[data-act=settings]').click();
  await page.selectOption('#set-colourby', 'time');
  await page.click('#settings-form button[type=submit]');
  await waitForText(page.locator('.ds-card').nth(1).locator('.ds-scale'), /Time\s+08:\d\d GMT\s+08:\d\d GMT/);
});

test('split datasets share one colour scale, which can be switched off', async () => {
  const page = await openApp(browser, server);
  // VAN-02 drives twice as fast as the others
  const csv = fleetCsv().replace(/^(VAN-02,.*,)(\d+)$/gm, (m, a, v) => a + v * 2);
  await chooseFile(page, writeTemp('fleet2.csv', csv));
  await page.selectOption('#imp-colourby', 'col:Recorded speed (mph)');
  await finishImport(page, 3);
  await page.waitForFunction(() => document.querySelectorAll('.ds-scale').length === 3);
  const ends = () => page.locator('.ds-scale-ends').allInnerTexts();
  await waitForText(page.locator('.ds-scale').first(), /Same scale as the other 2 datasets/);
  const shared = await ends();
  assert.equal(new Set(shared).size, 1, `all three use the same range: ${JSON.stringify(shared)}`);
  assert.match(shared[0], /6\s+68/, 'from the slowest to the fastest van');

  await page.locator('.ds-card').first().locator('[data-act=settings]').click();
  await page.uncheck('#set-style [data-shared-scale]');
  await page.click('#settings-form button[type=submit]');
  await page.waitForFunction(() => !document.querySelector('.ds-scale-shared'));
  const own = await ends();
  assert.ok(new Set(own).size > 1, `each has its own range now: ${JSON.stringify(own)}`);

  // Remembered after a reload
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.ds-scale').length === 3);
  assert.equal(await page.locator('.ds-scale-shared').count(), 0);
  assert.deepEqual(page.errors, []);
});

test('show all / hide all', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await page.click('#btn-hide-all');
  await page.waitForFunction(() => document.querySelectorAll('.dm-point-canvas').length === 0);
  assert.equal(await page.locator('.ds-card.is-hidden').count(), 3);
  await page.click('#btn-show-all');
  await page.waitForFunction(() => document.querySelectorAll('.dm-point-canvas').length === 3);
});

test('removing a dataset can be undone, back in the same place', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  const before = await page.locator('.ds-name').allInnerTexts();
  await page.locator('.ds-card').nth(1).locator('[data-act=remove]').click();
  assert.equal(await cardCount(page), 2);
  assert.match(await page.locator('#toast').innerText(), /Removed/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'toast-action');
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.locator('.ds-name').allInnerTexts(), before);
});

test('datasets and styles survive reloading the page', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await page.locator('.ds-card').first().locator('[data-act=settings]').click();
  await page.fill('#set-name', 'Renamed van');
  await page.click('#settings-form button[type=submit]');
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.ds-card').length === 3);
  assert.equal(await page.locator('.ds-name').first().innerText(), 'Renamed van');
});

test('data table lists points and "Show on map" opens one', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await page.locator('.ds-card').first().locator('[data-act=table]').click();
  assert.equal(await page.locator('#data-table tbody tr').count(), 10);
  await page.locator('#data-table [data-show]').nth(4).click();
  await page.waitForSelector('.pop-sub');
  assert.match(await page.locator('.pop-sub').innerText(), /5 of 10/);
});
