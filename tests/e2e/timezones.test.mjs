// Time zones: data lines up wherever the viewer is, the "Show times in"
// setting, and correcting a dataset's zone afterwards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openApp, loadSamples, pasteData, finishImport, cardMeta } from './helpers.mjs';

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); await server.close(); });

test('samples line up when viewed from New York', async () => {
  const page = await openApp(browser, server, { timezoneId: 'America/New_York', locale: 'en-US' });
  await loadSamples(page);
  assert.match(await cardMeta(page, 0), /Mar 14, 2024, 4:00:00\sAM EDT/);
  assert.match(await cardMeta(page, 1), /Mar 14, 2024, 5:10:00\sAM EDT/, 'survey crew was recorded in London time');
});

test('"Show times in" relabels everything', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await page.selectOption('#display-tz', 'UTC');
  assert.match(await cardMeta(page, 0), /08:00:00 UTC/);
  await page.selectOption('#display-tz', 'Asia/Tokyo');
  assert.match(await cardMeta(page, 0), /17:00:00 GMT\+9/);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.ds-card').length === 3);
  assert.equal(await page.inputValue('#display-tz'), 'Asia/Tokyo', 'the setting is remembered');
});

test("a dataset's time zone can be corrected after importing", async () => {
  const page = await openApp(browser, server);
  await page.selectOption('#display-tz', 'UTC');
  await pasteData(page, 'lat,lon,time\n51.5,-0.1,2024-07-01 09:00\n51.6,-0.2,2024-07-01 10:00');
  await page.selectOption('#imp-tz', 'UTC');
  await finishImport(page, 1);
  assert.match(await cardMeta(page, 0), /09:00:00 UTC/);
  await page.locator('[data-act=settings]').click();
  await page.selectOption('#set-tz', 'Europe/London');
  await page.click('#settings-form button[type=submit]');
  assert.match(await cardMeta(page, 0), /08:00:00 UTC/, '09:00 British Summer Time is 08:00 UTC');
});
