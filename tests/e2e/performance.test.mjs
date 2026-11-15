// Large files must stay quick. The limits are generous so slower test machines
// pass, but they still catch a return to the old one-element-per-marker speeds
// (13 s to add 25,000 points, 30 s to open the replay).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openApp, chooseFile, finishImport, settle, writeTemp, bigCsv } from './helpers.mjs';

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); await server.close(); });

test('25,000 points: adding, zooming, replay and reopening stay fast', async () => {
  const page = await openApp(browser, server);
  await chooseFile(page, writeTemp('big.csv', bigCsv(25000)));
  await page.selectOption('#imp-colourby', 'speed');

  let t = Date.now();
  await finishImport(page, 1);
  const addMs = Date.now() - t;
  assert.ok(addMs < 4000, `adding took ${addMs} ms`);

  t = Date.now();
  await page.click('.leaflet-control-zoom-in');
  await page.waitForTimeout(300);
  await settle(page);
  const zoomMs = Date.now() - t - 300;
  assert.ok(zoomMs < 2000, `zooming took ${zoomMs} ms`);

  t = Date.now();
  await page.click('#btn-replay');
  await settle(page);
  const replayMs = Date.now() - t;
  assert.ok(replayMs < 3000, `opening replay took ${replayMs} ms`);

  const seekMs = await page.evaluate(() => {
    const s = document.getElementById('rp-slider');
    const a = performance.now();
    for (const v of [200, 500, 900]) { s.value = v; s.dispatchEvent(new Event('input')); }
    return (performance.now() - a) / 3;
  });
  assert.ok(seekMs < 400, `moving the replay slider took ${Math.round(seekMs)} ms`);

  await page.click('#rp-close');
  t = Date.now();
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.ds-card').length === 1);
  await settle(page);
  const reloadMs = Date.now() - t;
  assert.ok(reloadMs < 5000, `reopening took ${reloadMs} ms`);
  assert.deepEqual(page.errors, []);
});
