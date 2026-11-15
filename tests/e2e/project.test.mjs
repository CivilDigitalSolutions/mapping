// Keeping work safe: project files, the backup reminder, storage usage and
// what happens when the browser can't save.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openApp, loadSamples, download, cardCount, writeTemp } from './helpers.mjs';

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); await server.close(); });

async function openProject(page, file) {
  await page.setInputFiles('#project-input', []);
  await page.setInputFiles('#project-input', file);
}

test('backup reminder changes as you add data, save and edit', async () => {
  const page = await openApp(browser, server);
  const status = () => page.locator('#storage-status').innerText();
  assert.match(await status(), /stays on this device/);
  await loadSamples(page);
  assert.match(await status(), /only kept in this browser/);
  assert.equal(await page.locator('#storage-box.is-warn').count(), 1);
  await download(page, () => page.click('#btn-save-project'));
  assert.match(await status(), /Backed up to a project file just now/);
  assert.equal(await page.locator('#storage-box.is-warn').count(), 0);
  await page.locator('.ds-card').nth(2).locator('.switch').click();
  await page.waitForFunction(() => /made changes since/.test(document.getElementById('storage-status').textContent));
  await page.waitForFunction(() => /Using .* of the .* this browser allows/.test(document.getElementById('storage-usage').textContent));
});

test('a project file opens on another computer, and can be added or replace what is there', async () => {
  const a = await openApp(browser, server);
  await loadSamples(a);
  const saved = await download(a, () => a.click('#btn-save-project'));
  assert.match(saved.name, /^Data_Mapper_project_\d{4}-\d{2}-\d{2}\.json$/);
  const project = JSON.parse(saved.bytes.toString('utf8'));
  assert.equal(project.format, 'data-mapper-project');
  assert.equal(project.datasets.length, 3);
  assert.equal(project.datasets[1].timeZone, 'Europe/London');

  // A different "computer": new browser profile, in Tokyo
  const b = await openApp(browser, server, { timezoneId: 'Asia/Tokyo' });
  await openProject(b, saved.path);
  await b.waitForFunction(() => document.querySelectorAll('.ds-card').length === 3);
  assert.match(await b.locator('#toast').innerText(), /Opened 3 datasets \(22 points\)/);

  await openProject(b, saved.path);
  await b.waitForSelector('#dlg-confirm[open]');
  await b.click('#confirm-buttons button[value=add]');
  await b.waitForFunction(() => document.querySelectorAll('.ds-card').length === 6);

  await openProject(b, saved.path);
  await b.click('#confirm-buttons button[value=replace]');
  await b.waitForFunction(() => document.querySelectorAll('.ds-card').length === 3);

  // Project files also open through Add data
  await b.click('#btn-add');
  await b.setInputFiles('#file-input', saved.path);
  await b.waitForSelector('#dlg-confirm[open]');
  await b.click('#confirm-buttons button[value=""]');
  assert.equal(await cardCount(b), 3);
});

test('a damaged project file is refused with a clear message', async () => {
  const page = await openApp(browser, server);
  await openProject(page, writeTemp('broken.json', '{"format":"data-mapper-project","version":1,"datasets":[{"name":"x"}]}'));
  await page.waitForFunction(() => /dataset 1 is damaged/.test(document.getElementById('toast').textContent));
  assert.equal(await cardCount(page), 0);
});

test('when the browser cannot save, a warning offers to save a project file', async () => {
  const page = await openApp(browser, server, { initScript: () => Object.defineProperty(window, 'indexedDB', { value: undefined }) });
  await loadSamples(page);
  await page.waitForFunction(() => /couldn't be saved in this browser/.test(document.getElementById('toast').textContent));
  assert.equal(await page.locator('#toast-action').innerText(), 'Save project file');
  assert.match(await page.locator('#storage-status').innerText(), /couldn't be saved/);
});
