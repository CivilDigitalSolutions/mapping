// Hostile and awkward input: nothing from a file may run as code, freeze the
// app, or come out of an export as a spreadsheet formula. Plus data edge cases
// found in user testing (date line, Excel dates, one-time data).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { startServer, launch, openApp, chooseFile, pasteData, finishImport, writeTemp, download, waitForText } from './helpers.mjs';

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); await server.close(); });

// Running this markup as HTML would bump window.__pwned
const XSS = '<img src=x onerror="window.__pwned=(window.__pwned||0)+1">';
const initScript = () => { window.__pwned = 0; };
const pwned = (page) => page.evaluate(() => window.__pwned);

test('a hostile project file is cleaned: no script runs and the app keeps working', async () => {
  const page = await openApp(browser, server, { initScript });
  const project = {
    format: 'data-mapper-project', version: 1, displayTimeZone: 'Bad/Zone',
    datasets: [{
      name: `Evil ${XSS}`,
      // A bad colour used to freeze the page as well as inject markup
      style: { color: `#000"><img src=x onerror="window.__pwned=1">`, size: '26" onmouseover="x', shape: 'nope', lineStyle: 'zigzag', colourBy: '<b>', speedUnit: 'warp' },
      timeZone: 'Not/AZone',
      source: XSS,
      skipped: [{ row: 1, reason: XSS }],
      points: [{ lat: 51.5, lon: -0.1, t: 1710403200000, label: XSS, props: { note: { nested: true }, ok: XSS } }, { lat: 51.51, lon: -0.11, t: 1710403500000 }],
    }],
  };
  await page.setInputFiles('#project-input', writeTemp('evil.json', JSON.stringify(project)));
  await page.waitForFunction(() => document.querySelectorAll('.ds-card').length === 1, null, { timeout: 8000 });
  assert.match(await page.locator('.ds-name').innerText(), /^Evil <img src=x/, 'the name is shown as text');
  await page.locator('.ds-card [data-act=settings]').click();
  assert.equal(await page.locator('#set-style input[type=color]').inputValue(), '#0072b2', 'the colour was replaced with a safe one');
  await page.keyboard.press('Escape');
  await page.click('#btn-replay');
  await page.click('#rp-close');
  await page.locator('.ds-card [data-act=table]').click();
  await page.keyboard.press('Escape');
  assert.equal(await pwned(page), 0);
  assert.deepEqual(page.errors, []);
});

test('a damaged project file gets a plain message', async () => {
  const page = await openApp(browser, server);
  await page.setInputFiles('#project-input', writeTemp('broken.json', '{"format": "data-mapper-project", oops'));
  await waitForText(page.locator('#toast'), /damaged or isn't a Data Mapper project file/);
});

test('markup in a CSV never runs, in the app or in a saved map file', async () => {
  const page = await openApp(browser, server, { initScript });
  await chooseFile(page, writeTemp('xss.csv', `name,lat,lon,time,${XSS}\n"${XSS.replace(/"/g, '""')}",51.5,-0.1,2024-03-14T08:00Z,x\n"<script>window.__pwned=9</script>",51.51,-0.11,2024-03-14T08:05Z,"javascript:alert(1)"\n`));
  await finishImport(page, 1);
  await page.locator('.ds-card [data-act=table]').click();
  await page.keyboard.press('Escape');
  await page.locator('.dm-focus').first().click();
  await page.waitForSelector('.pop-title');
  assert.equal(await pwned(page), 0);

  await page.click('#btn-export');
  await page.check('[name=exportkind][value=map]');
  const file = await download(page, () => page.click('#ex-go'));
  const html = file.bytes.toString('utf8');
  assert.match(html, /http-equiv="Content-Security-Policy"/, 'the map file carries its own security policy');
  const ctx = await browser.newContext();
  await ctx.addInitScript(initScript);
  await ctx.route(/^https?:/, (r) => r.abort());
  const v = await ctx.newPage();
  await v.goto(pathToFileURL(file.path).href);
  await v.waitForFunction(() => window.dmViewer);
  await v.locator('.leaflet-marker-icon').first().click();
  await v.locator('[data-table="0"]').click();
  assert.equal(await v.evaluate(() => window.__pwned), 0);
  await ctx.close();
  assert.deepEqual(page.errors, []);
});

test('CSV exports neutralise spreadsheet formulas but keep numbers', async () => {
  const page = await openApp(browser, server);
  await chooseFile(page, writeTemp('formula.csv', 'name,lat,lon,note\n"=HYPERLINK(""http://evil.example"",""click"")",51.5,-0.1,+cmd|calc\n@SUM(1),51.51,-0.11,-2+3\n'));
  await finishImport(page, 1);
  const card = page.locator('.ds-card').first();
  await card.locator('summary').click();
  const csv = (await download(page, () => card.locator('[data-act=export-csv]').click())).bytes.toString('utf8');
  const lines = csv.trim().split(/\r?\n/);
  assert.equal(lines[0], 'name,latitude,longitude,datetime,note', 'the name column is not written twice');
  assert.match(lines[1], /^"'=HYPERLINK\(/);
  assert.match(lines[1], /,51\.5,-0\.1,,'\+cmd\|calc$/);
  assert.equal(lines[2], "'@SUM(1),51.51,-0.11,,'-2+3");
});

test('the app only runs its own scripts', async () => {
  const page = await openApp(browser, server);
  const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /object-src 'none'/);
  const outside = await page.evaluate(() => [...document.scripts].map((s) => s.src).filter((s) => s && !s.startsWith(location.origin)));
  assert.deepEqual(outside, []);
  // An injected inline script is refused by the browser
  const ran = await page.evaluate(() => new Promise((r) => {
    window.__inline = false;
    const s = document.createElement('script');
    s.textContent = 'window.__inline = true';
    document.head.appendChild(s);
    setTimeout(() => r(window.__inline), 100);
  }));
  assert.equal(ran, false);
});

test('a route across the date line is drawn the short way, and found by "Who was here?"', async () => {
  const page = await openApp(browser, server);
  await pasteData(page, 'lat,lon,time\n-17.0,179.99,2024-03-14T08:00Z\n-17.0,-179.99,2024-03-14T08:10Z');
  await finishImport(page, 1);
  assert.match(await page.locator('#analysis-summary').innerText(), /None found/, 'not flagged as a GPS jump');
  await page.click('#nearby-box > summary');
  await page.fill('#nb-coords', '-17.0, 180');
  await page.click('#nb-coords-form button');
  await waitForText(page.locator('#nearby-summary'), /^1 visit within 50 m$/);
  assert.deepEqual(page.errors, []);
});

test('Excel serial dates are exact to the second; one-time data offers no video', async () => {
  const page = await openApp(browser, server);
  await chooseFile(page, writeTemp('xl.csv', 'lat,lon,date\n51.50,-0.10,45365.3333333\n51.51,-0.11,45365.5\n'));
  await finishImport(page, 1);
  assert.match(await page.locator('.ds-meta').innerText(), /14 Mar 2024, 08:00:00 GMT – 14 Mar 2024, 12:00:00 GMT/);

  const one = await openApp(browser, server);
  await pasteData(one, 'lat,lon,time\n51.5,-0.1,2024-03-14T08:00Z');
  await finishImport(one, 1);
  await one.click('#btn-export');
  assert.ok(await one.locator('[name=exportkind][value=video]').isDisabled());
  assert.match(await one.locator('#video-desc').innerText(), /at least two different dates or times/);
});
