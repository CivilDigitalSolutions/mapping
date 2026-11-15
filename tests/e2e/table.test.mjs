// The points table: search, sort, select, delete (with Undo), delete what the
// filter hides, and edit a point.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer, launch, openApp, loadSamples, cardMeta, waitForText, chooseFile, finishImport, writeTemp, bigCsv } from './helpers.mjs';

const AXE = createRequire(import.meta.url)('axe-core').source;

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); await server.close(); });

const rows = (page) => page.locator('#data-table tbody tr');
/** Cell texts of a column, by its number or its heading. */
async function column(page, n) {
  if (typeof n === 'string') {
    const heads = await page.locator('#data-table thead th').allInnerTexts();
    n = heads.findIndex((h) => h.replace(/[▲▼]/g, '').trim() === n) + 1;
    assert.ok(n > 0, 'column found');
  }
  return page.locator(`#data-table tbody tr td:nth-child(${n})`).allInnerTexts();
}

async function openTable(page, card = 0) {
  await page.locator('.ds-card').nth(card).locator('[data-act=table]').click();
  await page.waitForSelector('#dlg-table[open]');
}

test('search and sort the points', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await openTable(page, 1); // the survey: S1–S8 with notes
  assert.equal(await rows(page).count(), 8);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tbl-search');

  await page.fill('#tbl-search', 'survey');
  await waitForText(page.locator('#tbl-status'), /^2 matching points\./);
  assert.deepEqual(await column(page, 'Point'), ['S1', 'S8']);
  await page.fill('#tbl-search', 'kerb 09:32');
  await waitForText(page.locator('#tbl-status'), /^1 matching point\./);
  await page.fill('#tbl-search', 'nothing like this');
  await waitForText(page.locator('#data-table tfoot'), /No points match/);
  await page.fill('#tbl-search', '');
  await waitForText(page.locator('#tbl-status'), /^8 points\./);

  // Sort by Notes: empty notes go last both ways
  await page.click('#data-table [data-sort="col:Notes"]');
  let notes = await column(page, 'Notes');
  assert.deepEqual(notes.slice(0, 3), ['After lunch', 'Drainage blocked', 'End of survey']);
  assert.deepEqual(notes.slice(-2), ['', '']);
  assert.equal(await page.locator('th[aria-sort]').getAttribute('aria-sort'), 'ascending');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.sort), 'col:Notes', 'focus stays on the heading');
  await page.keyboard.press('Enter');
  notes = await column(page, 'Notes');
  assert.equal(notes[0], 'Start of survey');
  assert.deepEqual(notes.slice(-2), ['', '']);
  assert.equal(await page.locator('th[aria-sort]').getAttribute('aria-sort'), 'descending');

  // Accessible in this state
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate(async () => (await window.axe.run('#dlg-table', { resultTypes: ['violations'] })).violations.map((v) => `${v.id}: ${v.nodes.length}`));
  assert.deepEqual(result, []);
  assert.deepEqual(page.errors, []);
});

test('select and delete points, then Undo', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await openTable(page, 0);
  await page.locator('#data-table [data-row="1"]').check();
  await page.locator('#data-table [data-row="2"]').check();
  await waitForText(page.locator('#tbl-status'), /10 points, 2 selected/);
  assert.equal(await page.locator('#tbl-delete').innerText(), 'Delete 2 selected');
  await page.click('#tbl-delete');
  await waitForText(page.locator('#tbl-undo-text'), /Deleted 2 points/);
  assert.equal(await rows(page).count(), 8);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tbl-undo');
  assert.match(await cardMeta(page, 0), /^8 points/);
  assert.deepEqual((await column(page, 2)).slice(0, 3), ['1', '2', '3'], 'route numbers follow the change');

  await page.click('#tbl-undo');
  await waitForText(page.locator('#tbl-status'), /^10 points\./);
  assert.match(await cardMeta(page, 0), /^10 points/);

  // Delete again and close: Undo is still offered, and the deletion survives a reload otherwise
  await page.locator('#data-table [data-row="0"]').check();
  await page.click('#tbl-delete');
  await page.keyboard.press('Escape');
  await waitForText(page.locator('#toast'), /Deleted 1 point/);
  await page.click('#toast-action');
  await waitForText(page.locator('.ds-card').first().locator('.ds-meta'), /^10 points/);

  await openTable(page, 0);
  await page.locator('#data-table [data-row="9"]').check();
  await page.click('#tbl-delete');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.ds-card').length === 3);
  assert.match(await cardMeta(page, 0), /^9 points/);

  // Every point can't be deleted: that's what removing the dataset is for
  await openTable(page, 2);
  await page.click('#tbl-select-all');
  await page.click('#tbl-delete');
  await waitForText(page.locator('#toast'), /at least one point/);
  assert.equal(await rows(page).count(), 4);
  assert.deepEqual(page.errors, []);
});

test('delete everything the filter hides', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await page.click('#filter-box > summary');
  await page.fill('#flt-from', '2024-03-14T08:30');
  await page.fill('#flt-to', '2024-03-14T09:30');
  await waitForText(page.locator('#filter-summary'), /points/);
  await openTable(page, 0);
  // 08:34, 08:41, 08:49, 08:55 and 09:04
  assert.equal(await rows(page).count(), 5);
  await waitForText(page.locator('#tbl-filter-text'), /hiding 5 points/);
  await page.click('#tbl-delete-hidden');
  await waitForText(page.locator('#tbl-undo-text'), /Deleted 5 points/);
  await page.keyboard.press('Escape');
  await page.click('#flt-clear');
  await waitForText(page.locator('.ds-card').first().locator('.ds-meta'), /^5 points/);
  assert.deepEqual(page.errors, []);
});

test('edit a point: name, time, position and a column, with checks and Undo', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await openTable(page, 1);
  await page.locator('#data-table [data-edit="2"]').click(); // S3, 10:05, no note
  await page.waitForSelector('#dlg-point[open]');
  assert.equal(await page.inputValue('#pt-props [data-field="Point"]'), 'S3');
  assert.equal(await page.inputValue('#pt-time'), '2024-03-14 10:05:00');
  assert.match(await page.locator('#pt-zone').innerText(), /Europe\/London/);

  // Mistakes are explained next to the field, and nothing changes
  await page.fill('#pt-lat', '123');
  await page.fill('#pt-time', 'teatime');
  await page.click('#pt-save');
  assert.ok(await page.locator('#pt-time-err').isVisible());
  assert.ok(await page.locator('#pt-lat-err').isVisible());
  assert.equal(await page.locator('#pt-time').getAttribute('aria-invalid'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pt-time');

  await page.fill('#pt-name', 'Inspection 3');
  await page.fill('#pt-time', '14/03/2024 10:07');
  await page.fill('#pt-lat', '51°29\'30"N');
  await page.fill('#pt-lon', '-0.1150');
  await page.fill('#pt-props [data-field="Notes"]', 'Checked on site');
  await page.click('#pt-save');
  await waitForText(page.locator('#tbl-undo-text'), /Edited Inspection 3/);
  const cells = async () => {
    const heads = (await page.locator('#data-table thead th').allInnerTexts()).map((h) => h.replace(/[▲▼]/g, '').trim());
    const vals = await page.locator('#data-table tbody tr').nth(2).locator('td').allInnerTexts();
    return Object.fromEntries(heads.map((h, i) => [h, vals[i]]));
  };
  const c = await cells();
  assert.equal(c.Name, 'Inspection 3');
  assert.match(c['Date & time'], /10:07:00/);
  assert.equal(c.Latitude, '51.491667');
  assert.equal(c.Longitude, '-0.115000');
  assert.equal(c.Notes, 'Checked on site');

  await page.click('#tbl-undo');
  await waitForText(page.locator('#tbl-undo-row'), /./);
  await page.waitForFunction(() => document.getElementById('tbl-undo-row').hidden);
  const back = await cells();
  assert.equal(back.Name, '');
  assert.equal(back.Notes, '');
  assert.match(back['Date & time'], /10:05:00/);
  assert.deepEqual(page.errors, []);
});

test('large tables are shown a page at a time', async () => {
  const page = await openApp(browser, server);
  await chooseFile(page, writeTemp('big.csv', bigCsv(1000)));
  await finishImport(page, 1);
  await openTable(page, 0);
  assert.equal(await rows(page).count(), 200);
  assert.match(await page.locator('#tbl-page').innerText(), /Page 1 of 5/);
  await page.click('#tbl-next');
  assert.match(await page.locator('#tbl-page').innerText(), /Page 2 of 5 \(rows 201–400\)/);
  assert.equal((await column(page, 2))[0], '201');
  await page.click('#tbl-select-all');
  await waitForText(page.locator('#tbl-status'), /1,000 points, 1,000 selected/);
  assert.deepEqual(page.errors, []);
});
