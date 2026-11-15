// Automated accessibility checks (axe-core) across the main screens, in light and dark mode.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer, launch, openApp, loadSamples, pasteData } from './helpers.mjs';

const require = createRequire(import.meta.url);
const AXE = require('axe-core').source;

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); await server.close(); });

async function violations(page) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] }))
    .violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')})`));
}

for (const colorScheme of ['light', 'dark']) {
  test(`no accessibility problems on the main screen (${colorScheme})`, async () => {
    const page = await openApp(browser, server, { colorScheme });
    assert.deepEqual(await violations(page), [], 'empty state');
    await loadSamples(page);
    assert.deepEqual(await violations(page), [], 'with data');
  });
}

test('no accessibility problems in the dialogs and replay bar', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await pasteData(page, 'lat,lon,time\n51.5,-0.1,2024-01-01 10:00\n51.6,-0.2,2024-01-01 11:00');
  assert.deepEqual(await violations(page), [], 'import review');
  await page.keyboard.press('Escape');
  await page.click('#btn-export');
  assert.deepEqual(await violations(page), [], 'export dialog');
  await page.keyboard.press('Escape');
  await page.locator('.ds-card').first().locator('[data-act=settings]').click();
  assert.deepEqual(await violations(page), [], 'style dialog');
  await page.keyboard.press('Escape');
  await page.click('#btn-replay');
  assert.deepEqual(await violations(page), [], 'replay bar');
});
