// Adding data: pasting, files of every supported type, column choices,
// skipped rows, splitting one file into several datasets, and time zones.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openApp, pasteData, chooseFile, finishImport, cardCount, cardMeta, writeTemp, fleetCsv } from './helpers.mjs';

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); await server.close(); });

test('pasted spreadsheet rows with separate date and time columns, and a bad row', async () => {
  const page = await openApp(browser, server, { timezoneId: 'Europe/London' });
  await pasteData(page, 'lat\tlng\tdate\ttime\tnote\n51.52\t-0.10\t2024-03-06\t10:00\tA\n51.525\t-0.095\t2024-03-06\t09:00\tB\nbad\tvalue\t2024-03-06\t11:00\tC\n51.53\t-0.09\t2024-03-06\t11:30\tD');
  assert.equal(await page.inputValue('#imp-lat'), '0');
  assert.equal(await page.inputValue('#imp-lon'), '1');
  assert.equal(await page.locator('[name=timemode]:checked').getAttribute('value'), 'split');
  assert.match(await page.locator('#imp-status').innerText(), /3 of 4 rows will be mapped\. All have a date and time\. 1 will be skipped/);
  assert.equal(await page.locator('#imp-preview .bad-tag').count(), 1);
  await finishImport(page, 1);
  assert.match(await cardMeta(page, 0), /3 points · 6 Mar 2024, 09:00:00 GMT – 6 Mar 2024, 11:30:00 GMT/);
  assert.match(await page.locator('.ds-warn').innerText(), /1 row was skipped/);
  assert.deepEqual(page.errors, []);
});

test('coordinates in one column, degrees-minutes-seconds and WKT', async () => {
  const page = await openApp(browser, server);
  await pasteData(page, 'Site,Location\nA,"51°30\'26""N 0°07\'39""W"\nB,POINT(-0.1 51.6)\nC,"51.55, -0.12"');
  assert.equal(await page.locator('[name=coordmode]:checked').getAttribute('value'), 'combined');
  assert.match(await page.locator('#imp-status').innerText(), /3 of 3 rows will be mapped/);
  await finishImport(page, 1);
  assert.match(await cardMeta(page, 0), /^3 points/);
});

test('GeoJSON, GPX and KML files', async () => {
  const page = await openApp(browser, server);
  const files = {
    'route.geojson': JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { name: 'A', time: '2024-03-05T10:00:00Z' }, geometry: { type: 'Point', coordinates: [-0.1, 51.5] } },
      { type: 'Feature', properties: { name: 'B' }, geometry: { type: 'LineString', coordinates: [[-0.2, 51.4], [-0.21, 51.41]] } },
    ] }),
    'track.gpx': '<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><wpt lat="51.5" lon="-0.1"><name>WP1</name></wpt><trk><trkseg><trkpt lat="51.51" lon="-0.11"><time>2024-03-05T10:00:00Z</time></trkpt><trkpt lat="51.52" lon="-0.12"><time>2024-03-05T10:05:00Z</time></trkpt></trkseg></trk></gpx>',
    'place.kml': '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>K1</name><TimeStamp><when>2024-03-05T10:00:00Z</when></TimeStamp><Point><coordinates>-0.15,51.45,0</coordinates></Point></Placemark></Document></kml>',
  };
  const expected = { 'route.geojson': 3, 'track.gpx': 3, 'place.kml': 1 };
  let n = 0;
  for (const [name, text] of Object.entries(files)) {
    await chooseFile(page, writeTemp(name, text));
    assert.match(await page.locator('#imp-status').innerText(), new RegExp(`${expected[name]} of ${expected[name]} points will be mapped`), name);
    await finishImport(page, ++n);
  }
  assert.deepEqual(page.errors, []);
});

test('one file split into a dataset per vehicle, each with its own colour', async () => {
  const page = await openApp(browser, server);
  await chooseFile(page, writeTemp('fleet.csv', fleetCsv()));
  assert.equal(await page.inputValue('#imp-split'), 'Vehicle', 'the Vehicle column is suggested');
  assert.match(await page.locator('#imp-split-hint').innerText(), /3 datasets.*VAN-01 \(40\), VAN-02 \(40\), VAN-03 \(40\)/);
  await finishImport(page, 3);
  assert.deepEqual(await page.locator('.ds-name').allInnerTexts(), ['fleet: VAN-01', 'fleet: VAN-02', 'fleet: VAN-03']);
  const colours = await page.locator('.ds-card').evaluateAll((els) => els.map((e) => e.style.getPropertyValue('--ds-color')));
  assert.equal(new Set(colours).size, 3);
  assert.ok(await page.locator('#bulk-visibility').isVisible());
});

test('choosing not to split keeps one dataset', async () => {
  const page = await openApp(browser, server);
  await chooseFile(page, writeTemp('fleet2.csv', fleetCsv()));
  await page.selectOption('#imp-split', '');
  await finishImport(page, 1);
  assert.match(await cardMeta(page, 0), /^120 points/);
});

test('time zones: chosen zone for plain times, ignored for times that state one', async () => {
  const page = await openApp(browser, server, { timezoneId: 'America/New_York', locale: 'en-GB' });
  await page.selectOption('#display-tz', 'UTC');
  await pasteData(page, 'lat,lon,time\n35.68,139.76,2024-03-14 09:00\n35.69,139.70,2024-03-14 10:00');
  assert.ok(await page.locator('#imp-tz-field').isVisible());
  await page.selectOption('#imp-tz', 'Asia/Tokyo');
  await finishImport(page, 1);
  assert.match(await cardMeta(page, 0), /14 Mar 2024, 00:00:00 UTC – 14 Mar 2024, 01:00:00 UTC/);

  await pasteData(page, 'lat,lon,time\n51.5,-0.1,2024-03-14T09:00:00Z\n51.6,-0.2,2024-03-14T10:00:00Z');
  assert.ok(await page.locator('#imp-tz').isDisabled());
  assert.match(await page.locator('#imp-tz-hint').innerText(), /already say which time zone/);
});

test('several files at once become several datasets', async () => {
  const page = await openApp(browser, server);
  await page.click('#btn-add');
  await page.setInputFiles('#file-input', [writeTemp('a.csv', 'lat,lon\n51.5,-0.1\n51.6,-0.2'), writeTemp('b.csv', 'lat,lon\n52.5,-1.1\n52.6,-1.2')]);
  await page.waitForSelector('#import-step-map:not([hidden])');
  assert.match(await page.locator('#import-queue').innerText(), /1 more file/);
  await page.click('#btn-import-go');
  await page.waitForSelector('#import-step-map:not([hidden])');
  await finishImport(page, 2);
  assert.equal(await page.locator('#dlg-import').evaluate((d) => d.open), false);
});
