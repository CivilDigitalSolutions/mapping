// "Who was here?": choose a place and list each dataset's visits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer, launch, openApp, loadSamples, waitForText, download } from './helpers.mjs';

const AXE = createRequire(import.meta.url)('axe-core').source;

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); await server.close(); });

async function openBox(page) {
  if (!(await page.locator('#nearby-box').evaluate((d) => d.open))) await page.click('#nearby-box > summary');
}

test('typed coordinates: visits, nearest approach, Show, radius and CSV', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await openBox(page);
  // Bad input is explained
  await page.fill('#nb-coords', 'the depot');
  await page.click('#nb-coords-form button');
  assert.ok(await page.locator('#nb-coords-err').isVisible());

  // Vehicle 1's third point (08:13)
  await page.fill('#nb-coords', '51.50728, -0.12763');
  await page.click('#nb-coords-form button');
  await waitForText(page.locator('#nearby-summary'), /^1 visit within 50 m$/);
  assert.ok(await page.locator('#nb-coords-err').isHidden());
  const vehicle = page.locator('.nb-ds').nth(0);
  assert.match(await vehicle.innerText(), /Vehicle 1[\s\S]*1 visit[\s\S]*08:12:29 GMT → 08:13:33 GMT \(1m 4s\)[\s\S]*closest 0 m/);
  assert.match(await page.locator('.nb-ds').nth(1).innerText(), /Survey crew[\s\S]*Not within 50 m\. Closest: [\d.]+ (m|km) at 14 Mar 2024/);
  assert.equal(await page.locator('.leaflet-overlay-pane path.leaflet-interactive, .leaflet-overlay-pane path').count() > 0, true, 'circle drawn');

  // Wider: the survey crew's start (S1) is about 900 m away
  await page.selectOption('#nb-radius', '1000');
  await waitForText(page.locator('#nearby-summary'), /visits? within 1\.00 km/);
  assert.match(await page.locator('.nb-ds').nth(1).innerText(), /Survey crew[\s\S]*visit/);

  // Show opens the nearest recorded point
  await page.selectOption('#nb-radius', '50');
  await page.locator('[data-nb="0:0"]').click();
  await page.waitForSelector('.pop-sub');
  assert.match(await page.locator('.pop-sub').innerText(), /Vehicle 1.*3 of 10/);

  const csv = await download(page, () => page.click('#nb-csv'));
  const lines = csv.bytes.toString('utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^Sample: Vehicle 1 \(ISO date-times\),2024-03-14T08:1/);

  // Accessible
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run('#nearby-box', { resultTypes: ['violations'] })).violations.map((x) => `${x.id}: ${x.nodes.length}`));
  assert.deepEqual(v, []);

  await page.click('#nb-clear');
  await waitForText(page.locator('#nearby-summary'), /Pick a place/);
  assert.equal(await page.locator('.nb-centre').count(), 0);
  assert.deepEqual(page.errors, []);
});

test('pick on the map; the filter is followed', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await openBox(page);
  await page.click('#nb-pick');
  assert.equal(await page.getAttribute('#nb-pick', 'aria-pressed'), 'true');
  // Click exactly on Vehicle 1's first point (08:00): no popup opens, the place is set there
  await page.waitForSelector('.dm-focus');
  const b = await page.locator('.dm-focus').first().boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForSelector('.nb-centre');
  assert.equal(await page.getAttribute('#nb-pick', 'aria-pressed'), 'false');
  assert.equal(await page.locator('.leaflet-popup').count(), 0, 'picking does not open a popup');
  await waitForText(page.locator('.nb-ds').first(), /Vehicle 1[\s\S]*1 visit[\s\S]*08:00:00 GMT/);

  // A filter starting at 08:30 removes the visit
  await page.click('#filter-box > summary');
  await page.fill('#flt-from', '2024-03-14T08:30');
  await waitForText(page.locator('.nb-ds').first(), /Vehicle 1[\s\S]*Not within 50 m/);

  // Esc cancels picking
  await page.click('#nb-pick');
  await page.keyboard.press('Escape');
  assert.equal(await page.getAttribute('#nb-pick', 'aria-pressed'), 'false');
  assert.deepEqual(page.errors, []);
});
