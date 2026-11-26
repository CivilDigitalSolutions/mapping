// Cell sites preview: hidden unless switched on, the question on the import screen,
// column choices, sectors on the map, the Style dialog, the sample and project files.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openApp, pasteData, finishImport, settle, download } from './helpers.mjs';

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); await server.close(); });

const CSV = 'Site,Lat,Lon,Azimuth,Beamwidth,Radius\nA,51.50,-0.12,0,65,800\nA,51.50,-0.12,120,65,800\nB,51.52,-0.10,,65,500\nC,51.53,-0.09,200,,';

/** Number of sector shapes currently drawn on the map. */
const sectors = (page) => page.locator('path.dm-sector').count();

test('nothing about cell sites shows when the feature is switched off', async () => {
  const page = await openApp(browser, server, { query: '?cellsites=0' });
  await pasteData(page, CSV);
  assert.equal(await page.locator('#imp-cell-group').isVisible(), false);
  assert.equal(await page.locator('#btn-sample-cell').isVisible(), false);
  await finishImport(page, 1);
  assert.equal(await sectors(page), 0);
  await page.click('[data-act=settings]');
  assert.equal(await page.locator('#set-cell-group').isVisible(), false);
  assert.deepEqual(page.errors, []);
});

test('cell sites are on for everyone, but each dataset has to be opted in', async () => {
  const page = await openApp(browser, server); // no ?cellsites at all
  assert.equal(await page.locator('#btn-sample-cell').isVisible(), true);
  await pasteData(page, CSV);
  assert.equal(await page.locator('#imp-cell-group').isVisible(), true);
  assert.equal(await page.locator('#imp-cell-on').isChecked(), false, 'never ticked for the user');
  await page.click('#btn-import-go');
  await page.waitForSelector('.ds-card');
  await settle(page);
  assert.equal(await sectors(page), 0);
});

test('?cellsites=0 hides the feature in this browser, and ?cellsites=1 brings it back', async () => {
  const page = await openApp(browser, server);
  await page.goto(`${server.url}?cellsites=0`);
  assert.equal(await page.locator('#btn-sample-cell').isVisible(), false);
  await page.goto(server.url); // remembered
  assert.equal(await page.locator('#btn-sample-cell').isVisible(), false);
  await page.goto(`${server.url}?cellsites=1`);
  assert.equal(await page.locator('#btn-sample-cell').isVisible(), true);
});

test('the import screen asks, suggests the columns, and does nothing until ticked', async () => {
  const page = await openApp(browser, server, { query: '?cellsites=1' });
  await pasteData(page, CSV);
  assert.equal(await page.locator('#imp-cell-group').isVisible(), true);
  assert.match(await page.locator('#imp-cell-prompt').innerText(), /looks like it could be cell site data/i);
  assert.equal(await page.locator('#imp-cell-on').isChecked(), false, 'never ticked for the user');
  assert.equal(await page.locator('#imp-cell-fields').isVisible(), false);

  // Imported without ticking: no sectors, no cell settings saved
  await page.click('#btn-import-go');
  await page.waitForSelector('.ds-card');
  await settle(page);
  assert.equal(await sectors(page), 0);
  assert.equal(await page.evaluate(() => document.querySelector('.ds-meta').textContent.includes('cell sector')), false);
  assert.deepEqual(page.errors, []);
});

test('ticking the box shows the guessed columns and the sectors that will be drawn, then draws them', async () => {
  const page = await openApp(browser, server, { query: '?cellsites=1' });
  await pasteData(page, CSV);
  await page.check('#imp-cell-on');
  assert.equal(await page.inputValue('#imp-cell-az'), 'Azimuth');
  assert.equal(await page.inputValue('#imp-cell-beam'), 'Beamwidth');
  assert.equal(await page.inputValue('#imp-cell-radius'), 'Radius');
  assert.match(await page.locator('#imp-cell-status').innerText(), /3 sectors will be drawn\. 1 row has no readable azimuth/);

  await page.click('#btn-import-go');
  await page.waitForSelector('.ds-card');
  await settle(page);
  assert.equal(await sectors(page), 3);
  assert.match(await page.locator('.ds-meta').innerText(), /3 cell sectors/);

  // Clicking a sector opens the details of that antenna
  await page.locator('path.dm-sector').first().dispatchEvent('click');
  await page.waitForSelector('.leaflet-popup .pop');
  assert.match(await page.locator('.leaflet-popup .pop').innerText(), /Azimuth\s*0/);
  assert.deepEqual(page.errors, []);
});

test('without an azimuth column chosen it says so and draws nothing', async () => {
  const page = await openApp(browser, server, { query: '?cellsites=1' });
  await pasteData(page, CSV);
  await page.check('#imp-cell-on');
  await page.selectOption('#imp-cell-az', '');
  assert.match(await page.locator('#imp-cell-status').innerText(), /Choose the azimuth column/);
  await page.click('#btn-import-go');
  await page.waitForSelector('.ds-card');
  await settle(page);
  assert.equal(await sectors(page), 0);
});

test('data with no matching columns still asks, with the plain question', async () => {
  const page = await openApp(browser, server, { query: '?cellsites=1' });
  await pasteData(page, 'Name,Lat,Lon,Heading\nM1,51.5,-0.1,north\nM2,51.6,-0.1,south');
  assert.match(await page.locator('#imp-cell-prompt').innerText(), /^Does this data contain cell site/);
  assert.equal(await page.locator('#imp-cell-on').isChecked(), false);
  await page.check('#imp-cell-on');
  assert.equal(await page.inputValue('#imp-cell-az'), '', 'a text column is not guessed as the azimuth');
});

test('the Style dialog can switch cell sites on later, change the defaults, and off again', async () => {
  const page = await openApp(browser, server, { query: '?cellsites=1' });
  await pasteData(page, CSV);
  await page.click('#btn-import-go');
  await page.waitForSelector('.ds-card');
  await settle(page);
  assert.equal(await sectors(page), 0);

  await page.click('[data-act=settings]');
  assert.equal(await page.locator('#set-cell-group').isVisible(), true);
  await page.check('#set-cell-on');
  await page.waitForFunction(() => document.querySelectorAll('path.dm-sector').length === 3);
  const before = await page.locator('path.dm-sector').last().getAttribute('d'); // C uses the defaults
  await page.fill('#set-cell-dradius', '3');
  await page.selectOption('#set-cell-unit', 'km');
  await page.waitForFunction((b) => document.querySelector('path.dm-sector:last-of-type') && [...document.querySelectorAll('path.dm-sector')].pop().getAttribute('d') !== b, before);
  await page.uncheck('#set-cell-on');
  await page.waitForFunction(() => document.querySelectorAll('path.dm-sector').length === 0);
  assert.deepEqual(page.errors, []);
});

test('the cell site sample loads on its own, can be downloaded, and survives a reload', async () => {
  const page = await openApp(browser, server, { query: '?cellsites=1' });
  const dl = page.waitForEvent('download');
  await page.click('#btn-help');
  await page.click('#btn-sample-cell-csv');
  assert.equal((await dl).suggestedFilename(), 'sample-cell-sites.csv');
  await page.keyboard.press('Escape');

  await page.click('#btn-sample-cell');
  await page.waitForSelector('.ds-card');
  await settle(page);
  assert.equal(await page.locator('.ds-card').count(), 1, 'only the cell site sample, not the other samples');
  assert.equal(await sectors(page), 22);
  assert.match(await page.locator('.ds-meta').innerText(), /22 points · 22 cell sectors/);

  await page.waitForTimeout(500); // saving waits a moment
  await page.reload();
  await page.waitForSelector('.ds-card');
  await settle(page);
  assert.equal(await sectors(page), 22);
  assert.deepEqual(page.errors, []);
});

test('the ordinary sample data does not include cell sectors', async () => {
  const page = await openApp(browser, server, { query: '?cellsites=1' });
  await page.click('#btn-sample');
  await page.waitForFunction(() => document.querySelectorAll('.ds-card').length === 3);
  await settle(page);
  assert.equal(await sectors(page), 0);
});

test('cell site settings are kept in a project file', async () => {
  const page = await openApp(browser, server, { query: '?cellsites=1' });
  await page.click('#btn-sample-cell');
  await page.waitForSelector('.ds-card');
  const dl = await download(page, () => page.click('#btn-save-project'));
  const json = JSON.parse(dl.bytes.toString('utf8'));
  assert.equal(json.datasets[0].cell.on, true);
  assert.equal(json.datasets[0].cell.az, 'Azimuth');
  assert.equal(json.datasets[0].cell.unit, 'm');
});

test('the Add data window always offers the cell site sample, even with data on the map', async () => {
  const page = await openApp(browser, server, { query: '?cellsites=1' });
  await page.click('#btn-sample');
  await page.waitForFunction(() => document.querySelectorAll('.ds-card').length === 3);
  assert.equal(await page.locator('#btn-sample-cell').isVisible(), false, 'the empty-state button has gone with the data');
  await page.click('#btn-add');
  assert.equal(await page.locator('#btn-sample-cell-dlg').isVisible(), true);
  await page.click('#btn-sample-cell-dlg');
  await page.waitForFunction(() => document.querySelectorAll('.ds-card').length === 4);
  await settle(page);
  assert.equal(await page.locator('#dlg-import').evaluate((d) => d.open), false, 'the window closes');
  assert.equal(await sectors(page), 22);
  assert.deepEqual(page.errors, []);
});

test('the Add data window shows no cell site sample when the feature is off', async () => {
  const page = await openApp(browser, server, { query: '?cellsites=0' });
  await page.click('#btn-add');
  assert.equal(await page.locator('#btn-sample-cell-dlg').isVisible(), false);
});

test('the app and cell sites work with the service worker running', async () => {
  const page = await openApp(browser, server, { query: '?cellsites=1', serviceWorkers: 'allow' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  // The worker must not answer requests for the app's own scripts while developing on localhost
  const served = await page.evaluate(async () => {
    const res = await fetch('/js/capture.js', { cache: 'no-store' });
    return { ok: res.ok, controlled: !!navigator.serviceWorker.controller };
  });
  assert.equal(served.ok, true);
  await page.evaluate(async () => { const f = await import('/js/import-flow.js'); f.loadCellSample(); });
  await page.waitForSelector('.ds-card');
  await settle(page);
  assert.equal(await sectors(page), 22);
  assert.deepEqual(page.errors, []);
});
