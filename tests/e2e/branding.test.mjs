// Branding (logo and organisation name), scale bar / north arrow, and the
// replay's coloured lines and stop labels.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openApp, loadSamples, chooseFile, finishImport, writeTemp, eventsCsv, download, waitForText } from './helpers.mjs';

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); await server.close(); });

const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100"><rect width="300" height="100" rx="16" fill="#0b5cab"/><text x="150" y="64" font-family="sans-serif" font-size="44" font-weight="700" text-anchor="middle" fill="#fff">ACME</text></svg>';
const images = (pdf) => (pdf.bytes.toString('latin1').match(/\/Subtype \/Image/g) || []).length;

async function addLogo(page, name = 'Acme Surveys Ltd') {
  await page.click('#btn-export');
  await page.setInputFiles('#brand-file', writeTemp('logo.svg', LOGO_SVG));
  await page.waitForSelector('#brand-preview img');
  await page.fill('#brand-name', name);
}

test('a logo and name can be added, are remembered, and can be removed', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await addLogo(page);
  const src = await page.getAttribute('#brand-preview img', 'src');
  assert.match(src, /^data:image\/png;base64,/, 'SVG logos are turned into PNG');
  assert.equal(await page.locator('#brand-choose').innerText(), 'Change logo…');
  assert.ok(await page.locator('#brand-remove').isVisible());
  assert.equal(await page.isChecked('#brand-extras'), true, 'scale bar and north arrow are on by default');

  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.ds-card').length === 3);
  await page.click('#btn-export');
  await page.waitForSelector('#brand-preview img');
  assert.equal(await page.inputValue('#brand-name'), 'Acme Surveys Ltd');

  await page.click('#brand-remove');
  await waitForText(page.locator('#brand-preview'), /No logo/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'brand-choose');
});

test('files that are not images are refused with a message', async () => {
  const page = await openApp(browser, server);
  await page.click('#btn-add-empty').catch(() => {});
  await page.keyboard.press('Escape');
  await loadSamples(page);
  await page.click('#btn-export');
  await page.setInputFiles('#brand-file', writeTemp('notes.txt', 'not an image'));
  await waitForText(page.locator('#toast'), /PNG, JPEG, SVG or WebP|couldn't be read/);
  assert.ok(await page.locator('#brand-preview .muted').isVisible());
});

test('the PDF carries the logo and organisation name', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await page.click('#btn-export');
  const plain = await download(page, () => page.click('#ex-go'));
  await addLogo(page);
  const branded = await download(page, () => page.click('#ex-go'));
  // The logo adds an image, plus a transparency mask when it has transparent parts
  assert.ok(images(branded) >= images(plain) + 1, `the logo is included (${images(plain)} → ${images(branded)} images)`);
  assert.match(branded.bytes.toString('latin1'), /Acme Surveys Ltd/);
  assert.deepEqual(page.errors, []);
});

test('a branded video with scale bar and north arrow records', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await addLogo(page);
  await page.check('[name=exportkind][value=video]');
  await page.evaluate(() => document.getElementById('ex-length').add(new Option('3 seconds (test)', '3')));
  await page.selectOption('#ex-length', '3');
  await page.check('[name=exview][value=follow]');
  const video = await download(page, () => page.click('#ex-go'));
  assert.ok(video.bytes.length > 20000);
  assert.deepEqual(page.errors, []);
});

test('replay labels a parked vehicle with how long it has stopped', async () => {
  const page = await openApp(browser, server);
  await chooseFile(page, writeTemp('van.csv', eventsCsv()));
  await finishImport(page, 1);
  await page.click('#btn-replay');
  // The route runs 08:00–08:50; the stop is 08:05–08:15
  await page.locator('#rp-slider').fill('200'); // 08:10
  await page.waitForSelector('.dm-replay-stop');
  assert.match(await page.locator('.dm-replay-stop svg text').textContent(), /^Stopped 5m$/);
  await page.locator('#rp-slider').fill('600'); // 08:30, moving again
  await page.waitForFunction(() => !document.querySelector('.dm-replay-stop'));
});

test('replay with colour by value draws without errors', async () => {
  const page = await openApp(browser, server);
  await chooseFile(page, writeTemp('van.csv', eventsCsv()));
  await page.selectOption('#imp-colourby', 'speed');
  await finishImport(page, 1);
  await page.click('#btn-replay');
  for (const v of ['100', '400', '700', '1000', '300']) await page.locator('#rp-slider').fill(v);
  await page.click('#rp-play');
  await page.waitForTimeout(500);
  await page.click('#rp-play');
  assert.deepEqual(page.errors, []);
});

// A small logo in the middle of a big empty canvas, like many exported logo files
const PADDED_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#ffffff"/><rect x="300" y="250" width="200" height="100" fill="#0b5cab"/></svg>';

test('empty space around a logo is trimmed, and the size sliders change the previews and the PDF', async () => {
  const page = await openApp(browser, server);
  await loadSamples(page);
  await page.click('#btn-export');
  await page.setInputFiles('#brand-file', writeTemp('padded.svg', PADDED_SVG));
  await page.waitForSelector('#brand-preview img');
  assert.ok(await page.locator('#brand-sizing').isVisible(), 'sizing controls appear once there is a logo');
  const dims = await page.evaluate(async () => {
    const img = new Image();
    img.src = document.querySelector('#brand-preview img').src;
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  });
  // 800×600 is drawn at 1067×800; the artwork is 200×100 of the original
  assert.ok(dims[0] < 400 && dims[1] < 200, `white margins trimmed (got ${dims})`);
  assert.ok(Math.abs(dims[0] / dims[1] - 2) < 0.2, 'the artwork keeps its shape');

  await waitForText(page.locator('#brand-pdf-size-out'), /mm/);
  const before = await page.locator('#brand-pdf-size-out').innerText();
  await page.locator('#brand-pdf-size').fill('200');
  assert.equal(await page.locator('#brand-pdf-size-pct').innerText(), '200%');
  await waitForText(page.locator('#brand-pdf-size-out'), { test: (t) => /mm/.test(t) && t !== before });
  const [bw] = before.match(/\d+/).map(Number);
  const [aw] = (await page.locator('#brand-pdf-size-out').innerText()).match(/\d+/).map(Number);
  assert.ok(Math.abs(aw - bw * 2) <= 1, `PDF logo doubles in size (${before} → ${aw} mm)`);

  await page.locator('#brand-video-size').fill('150');
  assert.equal(await page.locator('#brand-video-size-pct').innerText(), '150%');
  await page.uncheck('#brand-panel');

  const pdf = await download(page, () => page.click('#ex-go'));
  assert.ok(images(pdf) >= 2, 'the PDF includes the map and the logo');

  // Remembered, and reset puts both back to 100%
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.ds-card').length === 3);
  await page.click('#btn-export');
  assert.equal(await page.inputValue('#brand-pdf-size'), '200');
  assert.equal(await page.inputValue('#brand-video-size'), '150');
  assert.equal(await page.isChecked('#brand-panel'), false);
  await page.click('#brand-reset-size');
  assert.equal(await page.inputValue('#brand-pdf-size'), '100');
  assert.equal(await page.inputValue('#brand-video-size'), '100');
  assert.deepEqual(page.errors, []);
});
