// The interactive map file: one HTML file that works on its own.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { startServer, launch, openApp, loadSamples, download, waitForText } from './helpers.mjs';

const AXE = createRequire(import.meta.url)('axe-core').source;

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); await server.close(); });

/** Open a saved file straight from disk, offline apart from (stand-in) map tiles. */
async function openFile(file, options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-GB', timezoneId: 'America/New_York', ...options });
  let other = 0;
  await ctx.route(/^https?:/, (r) => {
    if (/tile\.openstreetmap\.org/.test(r.request().url())) return r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8eee4"/></svg>' });
    other++;
    return r.abort();
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => window.dmViewer);
  page.otherRequests = () => other;
  return page;
}

async function saveMap(page, title = 'Client map') {
  await page.click('#btn-export');
  await page.check('[name=exportkind][value=map]');
  assert.equal(await page.locator('#ex-go').innerText(), 'Save map file');
  await page.fill('#ex-title', title);
  return download(page, () => page.click('#ex-go'));
}

test('saves one self-contained HTML file that works on its own', async () => {
  const app = await openApp(browser, server);
  await loadSamples(app);
  await app.fill('#brand-name', 'Acme Surveys').catch(() => {});
  const file = await saveMap(app);
  assert.match(file.name, /^Client_map_\d{4}-\d{2}-\d{2}\.html$/);
  const html = file.bytes.toString('utf8');
  assert.ok(!/<script[^>]+src=|<link[^>]+stylesheet/i.test(html), 'no outside scripts or stylesheets');
  assert.match(await app.locator('#toast').innerText(), /Interactive map saved/);
  assert.deepEqual(app.errors, []);

  const page = await openFile(file.path);
  assert.equal(await page.title(), 'Client map');
  assert.equal(await page.locator('#v-title').innerText(), 'Client map');
  // Times stay in the zone they were saved in (London), whatever the viewer's computer uses
  assert.match(await page.locator('#v-meta').innerText(), /Europe\/London/);
  assert.equal(await page.locator('.v-ds').count(), 3);
  assert.equal(await page.locator('.leaflet-marker-icon.v-marker').count(), 22);
  assert.match(await page.locator('.v-ds').first().innerText(), /Vehicle 1[\s\S]*10 points · 14 Mar 2024, 08:00:00 GMT – 14 Mar 2024, 09:04:00 GMT/);

  // Click a marker: details popup
  await page.locator('.leaflet-marker-icon.v-marker').nth(2).click();
  await page.waitForSelector('.v-pop');
  assert.match(await page.locator('.v-pop').innerText(), /Vehicle 1 \(ISO date-times\) · 3 of 10[\s\S]*14 Mar 2024, 08:13:00 GMT[\s\S]*Speed \(km\/h\)\s*31/);

  // Hide a dataset
  await page.locator('[data-ds="2"]').uncheck();
  assert.equal(await page.locator('.leaflet-marker-icon.v-marker').count(), 18);

  // Table, and Show from it
  await page.locator('[data-table="1"]').click();
  assert.equal(await page.locator('#v-table tbody tr').count(), 8);
  await page.locator('#v-table [data-show]').nth(1).click();
  await waitForText(page.locator('.v-pop'), /S2|Kerb damage/);

  // Replay
  await page.click('#v-replay-open');
  assert.ok(await page.locator('#v-replay').isVisible());
  assert.match(await page.locator('#v-clock').innerText(), /14 Mar 2024, 08:00:00 GMT/);
  await page.locator('#v-slider').fill('500');
  const mid = await page.locator('#v-clock').innerText();
  assert.match(mid, /14 Mar 2024, (10|11):\d\d:\d\d GMT/);
  await page.click('#v-play');
  await page.waitForTimeout(400);
  assert.notEqual(await page.locator('#v-clock').innerText(), mid, 'plays');
  await page.click('#v-replay-close');
  assert.ok(await page.locator('#v-replay').isHidden());

  // Accessible, and nothing but map tiles fetched
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.length}`));
  assert.deepEqual(v, []);
  assert.equal(page.otherRequests(), 0, 'only map tiles come from the internet');
  assert.deepEqual(page.errors, []);
});

test('the filter, colour by value and branding carry over; works on a phone', async () => {
  const app = await openApp(browser, server);
  await loadSamples(app);
  await app.locator('.ds-card').first().locator('[data-act=settings]').click();
  await app.selectOption('#set-colourby', 'speed');
  await app.click('#settings-form button[type=submit]');
  await app.click('#filter-box > summary');
  await app.fill('#flt-from', '2024-03-14T08:30');
  await waitForText(app.locator('#filter-summary'), /of 22 points/);
  await app.click('#btn-export');
  await app.fill('#brand-name', 'Acme Surveys');
  await app.keyboard.press('Escape');
  const file = await saveMap(app, 'Filtered');

  const page = await openFile(file.path, { viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true });
  assert.ok(await page.locator('#v-panel').evaluate((el) => el.getBoundingClientRect().right <= 1), 'key hidden at first on a phone');
  await page.click('#v-toggle');
  await page.waitForFunction(() => document.getElementById('v-panel').getBoundingClientRect().left >= 0);
  assert.equal(await page.locator('#v-org').innerText(), 'Acme Surveys');
  assert.match(await page.locator('#v-meta').innerText(), /Filtered to:/);
  assert.match(await page.locator('.v-ds').first().innerText(), /5 points[\s\S]*Speed \(mph\)/);
  await page.click('#v-close');
  assert.deepEqual(page.errors, []);
});
