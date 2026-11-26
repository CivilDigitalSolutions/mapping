// Cell sites in the exports: the PDF report, the replay video and the interactive map file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { startServer, launch, openApp, pasteData, settle, download } from './helpers.mjs';

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); await server.close(); });

const isVideo = (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' || b.readUInt32BE(0) === 0x1a45dfa3;
const sectors = (page) => page.locator('path.dm-sector').count();

/** The app with the ordinary samples (timed routes) and the cell site sample both on the map. */
async function appWithBoth() {
  const page = await openApp(browser, server, { query: '?cellsites=1' });
  // (Both buttons sit in the "No data yet" box, which goes once there is data, so call the app's own loaders)
  await page.evaluate(async () => {
    const flow = await import('/js/import-flow.js');
    flow.loadSamples();
    flow.loadCellSample();
  });
  await page.waitForFunction(() => document.querySelectorAll('.ds-card').length === 4);
  await settle(page);
  return page;
}

test('the PDF/video drawing paints filled sectors, in the dataset colour, and nothing outside them', async () => {
  const page = await openApp(browser, server, { query: '?cellsites=1' });
  await page.click('#btn-sample-cell');
  await page.waitForSelector('.ds-card');
  await settle(page);
  const px = await page.evaluate(async () => {
    const cap = await import('/js/capture.js');
    const { map } = await import('/js/mapview.js');
    const { destination } = await import('/js/cellsites.js');
    const cam = cap.makeCamera([51.5007, -0.1246], 15, 800, 600, 1);
    const c = document.createElement('canvas');
    c.width = 800; c.height = 600;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 800, 600);
    await cap.drawOverlays(ctx, map, cam);
    // LDN001 Westminster, sector A: azimuth 30, 800 m. Inside the wedge halfway out, then opposite the antenna.
    const at = (deg, m) => { const p = cam.toPoint(destination(51.5007, -0.1246, deg, m)); return [...ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data]; };
    return { inside: at(30, 400), outside: at(90, 400) /* between sectors A (30) and B (150) */, behind: at(210, 400) };
  });
  const [r, g, b] = px.inside;
  assert.ok(r < 255 && g < 250 && b < 255, `inside the sector is tinted, got ${px.inside}`);
  assert.ok(r > g && b > g, 'tinted with the pink dataset colour (#CC79A7)');
  assert.deepEqual(px.outside.slice(0, 3), [255, 255, 255], 'outside the sector is untouched');
});

test('a hovered sector is still exported in its normal style', async () => {
  const page = await openApp(browser, server, { query: '?cellsites=1' });
  await page.click('#btn-sample-cell');
  await page.waitForSelector('.ds-card');
  await settle(page);
  const style = await page.evaluate(async () => {
    const { map } = await import('/js/mapview.js');
    let poly;
    map.eachLayer((l) => { if (l.dmStyle && !poly) poly = l; });
    poly.fire('mouseover');
    return { now: poly.options.fillOpacity, resting: poly.dmStyle.fillOpacity };
  });
  assert.equal(style.now, 0.45);
  assert.equal(style.resting, 0.22);
});

test('PDF report: a Cell sites section, and the whole of each sector in the map', async () => {
  const page = await appWithBoth();
  await page.click('#btn-export');
  await page.fill('#ex-title', 'Cell report');
  const pdf = await download(page, () => page.click('#ex-go'), 90000);
  assert.equal(pdf.bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  const text = pdf.bytes.toString('latin1');
  assert.match(text, /Cell sites/);
  assert.match(text, /Sectors drawn/);
  assert.match(text, /azimuth/i);
  assert.match(await page.locator('#toast').innerText(), /PDF report saved/);
  assert.deepEqual(page.errors, []);
});

test('PDF report has no cell sites section when there are no cell sector datasets', async () => {
  const page = await openApp(browser, server, { query: '?cellsites=1' });
  await page.click('#btn-sample');
  await page.waitForFunction(() => document.querySelectorAll('.ds-card').length === 3);
  await page.click('#btn-export');
  const pdf = await download(page, () => page.click('#ex-go'), 90000);
  assert.doesNotMatch(pdf.bytes.toString('latin1'), /Sectors drawn/);
});

test('video: a replayed route with cell sectors underneath records without errors', async () => {
  const page = await appWithBoth();
  await page.click('#btn-export');
  await page.check('[name=exportkind][value=video]');
  await page.evaluate(() => document.getElementById('ex-length').add(new Option('3 seconds (test)', '3')));
  await page.selectOption('#ex-length', '3');
  const video = await download(page, () => page.click('#ex-go'), 90000);
  assert.ok(isVideo(video.bytes));
  assert.ok(video.bytes.length > 20000);
  assert.deepEqual(page.errors, []);
});

test('replay keeps the sectors of a dataset that is being replayed', async () => {
  const page = await openApp(browser, server, { query: '?cellsites=1' });
  const csv = 'Time,Lat,Lon,Azimuth\n2024-03-14T08:00:00Z,51.50,-0.12,0\n2024-03-14T08:10:00Z,51.51,-0.11,90\n2024-03-14T08:20:00Z,51.52,-0.10,180';
  await pasteData(page, csv);
  await page.check('#imp-cell-on');
  await page.click('#btn-import-go');
  await page.waitForSelector('.ds-card');
  await settle(page);
  assert.equal(await sectors(page), 3);
  await page.click('#btn-replay');
  await page.waitForSelector('#replay-bar:not([hidden])');
  await settle(page);
  assert.equal(await sectors(page), 3, 'still drawn while replaying');
  await page.click('#btn-replay');
  await settle(page);
  assert.equal(await sectors(page), 3, 'and after leaving replay, with no doubles');
  assert.deepEqual(page.errors, []);
});

test('interactive map file: sectors are inside the file and shown in the viewer', async () => {
  const page = await appWithBoth();
  await page.click('#btn-export');
  await page.check('[name=exportkind][value=map]');
  await page.fill('#ex-title', 'Cells');
  const file = await download(page, () => page.click('#ex-go'));
  assert.ok(!/<script[^>]+src=/i.test(file.bytes.toString('utf8')), 'still one self-contained file');

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-GB' });
  await ctx.route(/^https?:/, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8eee4"/></svg>' }));
  const viewer = await ctx.newPage();
  viewer.errors = [];
  viewer.on('pageerror', (e) => viewer.errors.push(e.message));
  await viewer.goto(pathToFileURL(file.path).href);
  await viewer.waitForFunction(() => window.dmViewer);
  await viewer.waitForTimeout(300);

  assert.equal(await viewer.locator('path.v-sector').count(), 22);
  assert.match(await viewer.locator('.v-ds').last().innerText(), /22 cell sectors/);
  // The same shapes as the app: the first sector's outline starts at its mast
  const first = await viewer.evaluate(() => window.dmViewer.data.datasets[3].cell.shapes[0]);
  assert.deepEqual(first[1][0], [51.5007, -0.1246]);

  // Clicking a sector shows that antenna's details
  await viewer.locator('path.v-sector').first().dispatchEvent('click');
  await viewer.waitForSelector('.v-pop');
  assert.match(await viewer.locator('.v-pop').innerText(), /Azimuth\s*30/);

  // Hiding the dataset hides its sectors; showing it brings them back
  const box = viewer.locator('.v-ds').last().locator('input[type=checkbox]');
  await box.uncheck();
  assert.equal(await viewer.locator('path.v-sector').count(), 0);
  await box.check();
  assert.equal(await viewer.locator('path.v-sector').count(), 22);

  // Replay does not remove the sectors
  await viewer.click('#v-replay-open');
  assert.equal(await viewer.locator('path.v-sector').count(), 22);
  assert.deepEqual(viewer.errors, []);
});

test('interactive map file: with the feature off, nothing about cell sites is saved', async () => {
  const page = await openApp(browser, server, { query: '?cellsites=1' });
  await page.click('#btn-sample-cell');
  await page.waitForSelector('.ds-card');
  await page.goto(`${server.url}?cellsites=0`); // switched off again: the saved dataset keeps its settings but isn't drawn
  await page.waitForSelector('.ds-card');
  assert.equal(await sectors(page), 0);
  await page.click('#btn-export');
  await page.check('[name=exportkind][value=map]');
  const file = await download(page, () => page.click('#ex-go'));
  assert.ok(!/"shapes"/.test(file.bytes.toString('utf8')));
});
