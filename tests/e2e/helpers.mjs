// Shared set-up for the browser tests.
//
// Each test file starts its own small web server for the app and its own
// headless Chromium. Map tiles are replaced with plain stand-in tiles (served
// with the same cross-origin header the real tile servers send), and the
// visitor counter is blocked, so the tests never touch the internet.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

/** Serve the app from the repository folder on a free port. */
export async function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (file.endsWith(path.sep)) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) };
}

export function launch() {
  return chromium.launch();
}

function tileSvg(z, x, y) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eef0ea"/><path d="M0 .5H256M.5 0V256" stroke="#c9cdc2" stroke-width="2"/><text x="128" y="134" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#99a">${z}/${x}/${y}</text></svg>`;
}

/**
 * Open the app in a fresh browser profile.
 * options: anything newContext() accepts, plus { initScript } to run before the app loads.
 * The page collects uncaught errors in page.errors.
 */
export async function openApp(browser, server, { initScript, ...options } = {}) {
  // UK English and London time by default, so dates look the same on any machine running the tests
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', acceptDownloads: true, locale: 'en-GB', timezoneId: 'Europe/London', ...options });
  await ctx.route(/tile\.openstreetmap\.org\/(\d+)\/(\d+)\/(\d+)\.png/, (r) => {
    const [, z, x, y] = r.request().url().match(/(\d+)\/(\d+)\/(\d+)\.png/);
    r.fulfill({ status: 200, contentType: 'image/svg+xml', body: tileSvg(z, x, y), headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await ctx.route(/goatcounter|zgo\.at|opentopomap|arcgisonline/, (r) => r.abort());
  if (initScript) await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  await page.goto(server.url);
  await page.waitForFunction(() => document.querySelector('#storage-status')?.textContent.length > 0);
  return page;
}

/** Wait for two animation frames, so drawing has caught up. */
export function settle(page) {
  return page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Run `action` and capture the file it downloads. Returns { name, path, bytes }. */
export async function download(page, action, timeout = 120000) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout }), action()]);
  const file = path.join(tmpDir(), d.suggestedFilename());
  await d.saveAs(file);
  return { name: d.suggestedFilename(), path: file, bytes: fs.readFileSync(file) };
}

let tmp;
export function tmpDir() {
  tmp = tmp || fs.mkdtempSync(path.join(os.tmpdir(), 'data-mapper-tests-'));
  return tmp;
}

/** Write text to a temporary file and return its path. */
export function writeTemp(name, text) {
  const file = path.join(tmpDir(), name);
  fs.writeFileSync(file, text);
  return file;
}

// ------------------------------------------------------------------ test data

/** One CSV holding three vans, 40 fixes each, with a recorded speed column. */
export function fleetCsv() {
  let csv = 'Vehicle,Latitude,Longitude,Timestamp,Recorded speed (mph)\n';
  const t0 = Date.UTC(2024, 2, 14, 8, 0);
  for (let v = 0; v < 3; v++) {
    let lat = 51.5 + v * 0.012, lon = -0.16, t = t0 + v * 300000;
    for (let i = 0; i < 40; i++) {
      const fast = i % 20 < 10;
      lon += fast ? 0.0035 : 0.0009;
      lat += Math.sin(i / 4 + v) * 0.0012;
      t += 60000;
      csv += `VAN-0${v + 1},${lat.toFixed(5)},${lon.toFixed(5)},${new Date(t).toISOString()},${fast ? 28 + (i % 7) : 6 + (i % 4)}\n`;
    }
  }
  return csv;
}

/** A long single track: n fixes, 30 s apart. */
export function bigCsv(n) {
  let csv = 'id,lat,lon,time,speed\n';
  const t0 = Date.UTC(2024, 0, 1);
  for (let i = 0; i < n; i++) {
    csv += `${i},${(51.4 + Math.sin(i / 900) * 0.2 + i * 0.00001).toFixed(5)},${(-0.4 + i * 0.00003).toFixed(5)},${new Date(t0 + i * 30000).toISOString()},${i % 60}\n`;
  }
  return csv;
}

// ------------------------------------------------------------------ app actions

export async function loadSamples(page) {
  await page.click('#btn-sample');
  await page.waitForFunction(() => document.querySelectorAll('.ds-card').length >= 3);
  await settle(page);
}

/** Add data through the "Paste data" tab and stop on the review screen. */
export async function pasteData(page, text) {
  await page.click('#btn-add');
  await page.click('#tab-paste');
  await page.fill('#paste-input', text);
  await page.click('#btn-use-paste');
  await page.waitForSelector('#import-step-map:not([hidden])');
}

/** Add a file through "Upload file" and stop on the review screen. */
export async function chooseFile(page, file) {
  await page.click('#btn-add');
  await page.setInputFiles('#file-input', file);
  await page.waitForSelector('#import-step-map:not([hidden])');
}

export async function finishImport(page, expectedCards) {
  await page.click('#btn-import-go');
  if (expectedCards !== undefined) await page.waitForFunction((n) => document.querySelectorAll('.ds-card').length === n, expectedCards);
  await settle(page);
}

export const cardCount = (page) => page.locator('.ds-card').count();
export const cardMeta = (page, i) => page.locator('.ds-meta').nth(i).innerText();

/** Wait (up to `timeout` ms) for a locator's text to match, then return it; fails with the last text seen. */
export async function waitForText(locator, re, timeout = 5000) {
  const end = Date.now() + timeout;
  let last = '';
  while (Date.now() < end) {
    last = await locator.innerText().catch(() => '');
    if (re.test(last)) return last;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Expected text matching ${re}, last saw: ${JSON.stringify(last)}`);
}
