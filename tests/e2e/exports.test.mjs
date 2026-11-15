// Exports: PDF report, replay video (fixed and follow camera), and per-dataset
// GeoJSON / CSV files.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openApp, loadSamples, download } from './helpers.mjs';

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); await server.close(); });

const isVideo = (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' || b.readUInt32BE(0) === 0x1a45dfa3; // MP4 or WebM

/** Videos record in real time, so the tests use a 3-second length. */
async function recordVideo(page, camera, extra = async () => {}) {
  await page.click('#btn-export');
  await page.check('[name=exportkind][value=video]');
  await page.evaluate(() => document.getElementById('ex-length').add(new Option('3 seconds (test)', '3')));
  await page.selectOption('#ex-length', '3');
  await page.check(`[name=exview][value=${camera}]`);
  await extra();
  return download(page, () => page.click('#ex-go'));
}

test('PDF report: title, map, summary and point tables', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await page.click('#btn-export');
  assert.equal(await page.locator('#ex-go').innerText(), 'Create PDF');
  await page.fill('#ex-title', 'Test report');
  await page.fill('#ex-for', 'Test client');
  const pdf = await download(page, () => page.click('#ex-go'));
  assert.match(pdf.name, /^Test_report_\d{4}-\d{2}-\d{2}\.pdf$/);
  assert.equal(pdf.bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  const pages = (pdf.bytes.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
  assert.equal(pages, 5, 'map page + summary + one table page per dataset');
  assert.match(await page.locator('#toast').innerText(), /PDF report saved/);
  assert.deepEqual(page.errors, []);
});

test('video with a fixed camera; the map is locked while recording', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  const pending = recordVideo(page, 'fit');
  await page.waitForFunction(() => /Recording/.test(document.getElementById('ex-status')?.textContent || ''));
  assert.equal(await page.locator('.leaflet-container.is-frozen').count(), 1);
  const video = await pending;
  assert.ok(isVideo(video.bytes), 'an MP4 or WebM file');
  assert.ok(video.bytes.length > 20000);
  assert.equal(await page.locator('.leaflet-container.is-frozen').count(), 0, 'unlocked afterwards');
  assert.deepEqual(page.errors, []);
});

test('video following one dataset', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  const video = await recordVideo(page, 'follow', async () => {
    assert.ok(await page.locator('#ex-follow-opts').isVisible());
    await page.selectOption('#ex-follow-target', { label: 'Sample: Vehicle 1 (ISO date-times)' });
    await page.selectOption('#ex-follow-zoom', '3');
  });
  assert.ok(isVideo(video.bytes));
  assert.deepEqual(page.errors, []);
});

test('stopping a recording part-way saves nothing', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await page.click('#btn-export');
  await page.check('[name=exportkind][value=video]');
  await page.click('#ex-go');
  await page.waitForFunction(() => /Recording/.test(document.getElementById('ex-status')?.textContent || ''));
  await page.click('#ex-cancel');
  await page.waitForFunction(() => /Recording stopped/.test(document.getElementById('ex-status')?.textContent || ''));
  assert.equal(await page.locator('#dlg-export').evaluate((d) => d.open), true);
});

test('per-dataset GeoJSON and CSV exports', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  const card = page.locator('.ds-card').first();
  await card.locator('summary').click();
  const geo = await download(page, () => card.locator('[data-act=export-geojson]').click());
  const json = JSON.parse(geo.bytes.toString('utf8'));
  assert.equal(json.type, 'FeatureCollection');
  assert.equal(json.features.filter((f) => f.geometry.type === 'Point').length, 10);
  assert.equal(json.features.filter((f) => f.geometry.type === 'LineString').length, 1);
  await card.locator('summary').click();
  const csv = await download(page, () => card.locator('[data-act=export-csv]').click());
  const lines = csv.bytes.toString('utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, 11);
  assert.match(lines[0], /^name,latitude,longitude,datetime/);
  assert.match(lines[1], /2024-03-14T08:00:00\.000Z/);
});
