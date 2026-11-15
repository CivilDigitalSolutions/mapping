// Filters (date range, time of day, column and speed rules) and finding
// stops, gaps in the recording and GPS jumps.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer, launch, openApp, loadSamples, chooseFile, finishImport, cardMeta, writeTemp, fleetCsv, eventsCsv, download, waitForText, settle } from './helpers.mjs';

const AXE = createRequire(import.meta.url)('axe-core').source;

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); await server.close(); });

async function openFilter(page) {
  if (!(await page.locator('#filter-box').evaluate((d) => d.open))) await page.click('#filter-box > summary');
}
const filterSummary = (page) => page.locator('#filter-summary');

async function loadEvents(page) {
  await chooseFile(page, writeTemp('van.csv', eventsCsv()));
  // One vehicle, so there's nothing to split by and the option is hidden
  assert.ok(await page.locator('#imp-split-field').isHidden());
  await finishImport(page, 1);
}

// ------------------------------------------------------------------ filters

test('date and time range: map, cards, keyboard targets and summary follow it', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await openFilter(page);
  await page.fill('#flt-from', '2024-03-14T08:00');
  await page.fill('#flt-to', '2024-03-14T08:30');
  await waitForText(filterSummary(page), /^5 of 22 points: 14 Mar, 08:00 to 14 Mar, 08:30/);
  assert.match(await cardMeta(page, 0), /^5 of 10 points shown · 14 Mar 2024, 08:00:00 GMT – 14 Mar 2024, 08:26:00 GMT/);
  assert.match(await cardMeta(page, 1), /^0 of 8 points shown/);
  assert.match(await cardMeta(page, 2), /^0 of 4 points shown/, 'points without a time are hidden by a time filter');
  await page.waitForFunction(() => document.querySelectorAll('.dm-focus').length === 5);
  assert.equal(await page.locator('#filter-box.is-on').count(), 1);

  await page.click('#flt-clear');
  await waitForText(filterSummary(page), /^Showing everything$/);
  await page.waitForFunction(() => document.querySelectorAll('.dm-focus').length === 22);
  assert.deepEqual(page.errors, []);
});

test('time of day and a column rule, together and separately', async () => {
  const page = await openApp(browser, server);
  await chooseFile(page, writeTemp('fleet.csv', fleetCsv()));
  await page.selectOption('#imp-split', '');
  await finishImport(page, 1);
  await openFilter(page);
  await page.selectOption('#flt-field', 'Vehicle');
  const suggestions = await page.locator('#flt-values option').evaluateAll((os) => os.map((o) => o.value));
  assert.deepEqual(suggestions, ['VAN-01', 'VAN-02', 'VAN-03'], 'values from the column are suggested');
  await page.fill('#flt-value', 'VAN-02');
  await waitForText(page.locator('.ds-meta').first(), /^40 of 120 points shown/);

  await page.selectOption('#flt-op', 'not');
  await waitForText(page.locator('.ds-meta').first(), /^80 of 120 points shown/);

  // Fixes run 08:01–08:50; 08:30–09:00 each day leaves the later part of each van's run
  await page.fill('#flt-tod-from', '08:30');
  await page.fill('#flt-tod-to', '09:00');
  const text = await waitForText(page.locator('.ds-meta').first(), /^(?!80 )\d+ of 120 points shown/);
  const n = Number(text.match(/^(\d+)/)[1]);
  assert.ok(n > 0 && n < 80, `time of day narrows it further (${n})`);
  assert.match(await filterSummary(page).innerText(), /08:30–09:00 each day · Vehicle is not VAN-02/);
});

test('speed rule, using speeds worked out from the times', async () => {
  const page = await openApp(browser, server);
  await chooseFile(page, writeTemp('fleet.csv', fleetCsv()));
  await page.selectOption('#imp-split', '');
  await finishImport(page, 1);
  await openFilter(page);
  await page.selectOption('#flt-field', '@speed');
  await page.selectOption('#flt-op', 'gte');
  await page.fill('#flt-value', '5');
  const text = await waitForText(page.locator('.ds-meta').first(), /^\d+ of 120 points shown/);
  const n = Number(text.match(/^(\d+)/)[1]);
  assert.ok(n > 10 && n < 120, `only the faster legs remain (${n})`);
});

test('the filter is remembered after a reload, and replay, table and CSV follow it', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await openFilter(page);
  await page.fill('#flt-from', '2024-03-14T08:10');
  await page.fill('#flt-to', '2024-03-14T08:45');
  await waitForText(filterSummary(page), /^5 of 22 points/);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.ds-card').length === 3);
  assert.equal(await page.locator('#filter-box').evaluate((d) => d.open), true, 'an active filter is shown open');
  assert.equal(await page.inputValue('#flt-from'), '2024-03-14T08:10');
  await waitForText(filterSummary(page), /^5 of 22 points/);

  await page.click('#btn-replay');
  assert.equal(await page.locator('#rp-start').innerText(), '14 Mar 2024, 08:13:00 GMT');
  assert.equal(await page.locator('#rp-end').innerText(), '14 Mar 2024, 08:41:00 GMT');
  await page.click('#rp-close');

  const card = page.locator('.ds-card').first();
  await card.locator('[data-act=table]').click();
  assert.equal(await page.locator('#data-table tbody tr').count(), 5);
  assert.match(await page.locator('#table-title').innerText(), /5 of 10 points \(filtered\)/);
  await page.keyboard.press('Escape');
  await card.locator('summary').click();
  const csv = await download(page, () => card.locator('[data-act=export-csv]').click());
  assert.equal(csv.bytes.toString('utf8').trim().split(/\r?\n/).length, 6, 'header + 5 filtered rows');
  assert.match(await page.locator('#toast').innerText(), /filtered: 5 of 10 points/);
});

// ------------------------------------------------------------------ stops, gaps and jumps

test('stops, gaps and jumps are found, summarised, badged and listed', async () => {
  const page = await openApp(browser, server);
  await loadEvents(page);
  await waitForText(page.locator('.ds-events'), /1 stop \(10m\) · 1 gap in the recording · 1 possible GPS jump/);
  await page.waitForFunction(() => document.querySelectorAll('.dm-event').length === 3);
  assert.equal(await page.locator('.dm-event-stop').count(), 1);
  assert.equal(await page.locator('.dm-event-gap').count(), 1);
  assert.equal(await page.locator('.dm-event-jump').count(), 1);
  assert.match(await page.locator('#analysis-summary').innerText(), /1 stop · 1 gap · 1 jump/);

  await page.locator('.ds-events [data-act=events]').click();
  assert.match(await page.locator('#table-title').innerText(), /Stops and problems/);
  const kinds = await page.locator('#data-table tbody tr td:first-child').allInnerTexts();
  assert.deepEqual(kinds, ['Stop', 'Gap in recording', 'Possible GPS jump'], 'in time order');
  await page.locator('#data-table [data-event]').first().click();
  await waitForText(page.locator('.leaflet-popup .pop-title'), /Stopped for 10m/);
});

test('keyboard: badges can be reached and opened, and focus comes back', async () => {
  const page = await openApp(browser, server);
  await loadEvents(page);
  await page.waitForSelector('.dm-event-gap');
  await page.locator('.dm-event-gap').focus();
  await page.keyboard.press('Enter');
  await waitForText(page.locator('.leaflet-popup .pop-title'), /Nothing recorded for 21m/);
  await page.waitForFunction(() => !!document.activeElement.closest('.leaflet-popup'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement.classList.contains('dm-event-gap'));
});

test('a GPS jump can be removed, and the removal undone', async () => {
  const page = await openApp(browser, server);
  await loadEvents(page);
  await page.waitForSelector('.dm-event-jump');
  await page.locator('.dm-event-jump').click();
  await page.click('.leaflet-popup [data-act=action]');
  await waitForText(page.locator('.ds-meta').first(), /^30 points/);
  await waitForText(page.locator('.ds-events'), /^1 stop \(10m\) · 1 gap in the recording\./);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'toast-action');
  await page.keyboard.press('Enter');
  await waitForText(page.locator('.ds-meta').first(), /^31 points/);
  await waitForText(page.locator('.ds-events'), /1 possible GPS jump/);
});

test('settings change what counts, and badges can be turned off', async () => {
  const page = await openApp(browser, server);
  await loadEvents(page);
  await page.click('#analysis-box > summary');
  await page.fill('#an-stop-min', '15');
  await waitForText(page.locator('.ds-events'), /^1 gap in the recording · 1 possible GPS jump/);
  await page.fill('#an-jump', '5000');
  await waitForText(page.locator('.ds-events'), /^1 gap in the recording\./);
  await page.uncheck('#an-show');
  await page.waitForFunction(() => document.querySelectorAll('.dm-event').length === 0);
  assert.match(await page.locator('.ds-events').innerText(), /1 gap/, 'still listed on the card');
  await page.selectOption('#an-unit', 'kmh');
  await page.waitForFunction(() => document.getElementById('an-jump').value === '8050', null, { timeout: 3000 });
});

test('the PDF notes the filter and lists the stops and problems', async () => {
  const page = await openApp(browser, server);
  await loadEvents(page);
  await openFilter(page);
  await page.fill('#flt-to', '2024-03-14T09:00');
  await waitForText(filterSummary(page), /of 31 points/);
  await page.click('#btn-export');
  const pdf = await download(page, () => page.click('#ex-go'));
  const text = pdf.bytes.toString('latin1');
  assert.match(text, /Filtered to: until 14 Mar, 09:00/);
  assert.match(text, /Stops and problems/);
  assert.match(text, /Possible GPS jump/);
  assert.deepEqual(page.errors, []);
});

test('no accessibility problems with the filter and stop boxes open and badges shown', async () => {
  const page = await openApp(browser, server);
  await loadEvents(page);
  await openFilter(page);
  await page.click('#analysis-box > summary');
  await page.selectOption('#flt-field', 'Vehicle');
  await settle(page);
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] }))
    .violations.map((x) => `${x.id}: ${x.help} (${x.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')})`));
  assert.deepEqual(v, []);
});
